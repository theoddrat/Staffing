"""Information-set calendar alignment (DESIGN.md §3.2) — the "US t-1 lag".

For a target calendar with close timestamps T_0 < T_1 < ... (UTC) and a source series with close
timestamps tau_k and log returns r_k (return from the previous source close to tau_k), the aligned
source return for target day j is

    x_j = sum of r_k over all k with T_{j-1} < tau_k <= T_j

* source closes before the target's own close on the same calendar day (e.g. Tokyo vs NSE) land in
  the same target day; closes after it (US, Europe vs NSE) land in the next target day (1-day lag);
* no source close inside the interval (source holiday) -> x_j = 0 (no new information);
* several source closes inside the interval (target holiday) -> their returns accumulate;
* target day 0 has no defined interval -> NaN.
"""
from __future__ import annotations

from datetime import time
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


def _parse_hhmm(s: str) -> time:
    hh, mm = s.split(":")
    return time(int(hh), int(mm))


def close_timestamps(dates: pd.DatetimeIndex | pd.Series | list, market: dict[str, Any]) -> pd.DatetimeIndex:
    """UTC close timestamps for local trading `dates` of a market {tz, close, close_before}.

    `close_before: {"YYYY-MM-DD": "HH:MM"}` gives the earlier close time used before that date.
    DST is handled by zoneinfo (localising each local close time on its own date).
    """
    idx = pd.DatetimeIndex(pd.to_datetime(dates))
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
    idx = idx.normalize()
    tz = ZoneInfo(market["tz"])
    default_close = _parse_hhmm(market["close"])
    secs = np.full(len(idx), default_close.hour * 3600 + default_close.minute * 60, dtype="int64")
    changes = sorted(((pd.Timestamp(k), _parse_hhmm(v)) for k, v in (market.get("close_before") or {}).items()),
                     reverse=True)
    for change_date, earlier in changes:  # latest change first; older entries override older dates
        mask = np.asarray(idx < change_date)
        secs[mask] = earlier.hour * 3600 + earlier.minute * 60
    local = idx + pd.to_timedelta(secs, unit="s")
    return pd.DatetimeIndex(local).tz_localize(tz, nonexistent="shift_forward", ambiguous=False).tz_convert("UTC")


def align_returns(
    target_closes_utc: pd.DatetimeIndex,
    source_closes_utc: pd.DatetimeIndex,
    source_logret: np.ndarray | pd.Series,
) -> tuple[np.ndarray, dict[str, int]]:
    """Core alignment on UTC close timestamps. Returns (aligned array len(target), diagnostics)."""
    T = np.asarray(pd.DatetimeIndex(target_closes_utc).asi8)
    tau = np.asarray(pd.DatetimeIndex(source_closes_utc).asi8)
    r = np.asarray(source_logret, dtype=float)
    if len(tau) != len(r):
        raise ValueError("source closes and returns must have equal length")
    if len(T) and np.any(np.diff(T) <= 0):
        raise ValueError("target closes must be strictly increasing")
    out = np.zeros(len(T), dtype=float)
    counts = np.zeros(len(T), dtype=int)
    ok = np.isfinite(r)
    # j = first target index with T_j >= tau  ->  tau in (T_{j-1}, T_j]
    j = np.searchsorted(T, tau[ok], side="left")
    inside = j < len(T)
    np.add.at(out, j[inside], r[ok][inside])
    np.add.at(counts, j[inside], 1)
    if len(out):
        out[0] = np.nan
        counts[0] = 0
    diag = {
        "zero_days": int(np.sum(counts[1:] == 0)),
        "accumulated_days": int(np.sum(counts[1:] > 1)),
    }
    return out, diag


def align_series(
    target_dates: pd.DatetimeIndex,
    target_market: dict[str, Any],
    source: pd.Series,
    source_market: dict[str, Any],
) -> tuple[pd.Series, dict[str, int]]:
    """Align a source log-return Series (indexed by its local trading dates) to target dates."""
    source = source.dropna()
    tc = close_timestamps(target_dates, target_market)
    sc = close_timestamps(source.index, source_market)
    vals, diag = align_returns(tc, sc, source.to_numpy())
    return pd.Series(vals, index=pd.DatetimeIndex(target_dates)), diag


def same_day(target_dates: pd.DatetimeIndex, source: pd.Series) -> pd.Series:
    """Plain calendar-date join (used for same-market peer betas)."""
    return source.reindex(pd.DatetimeIndex(target_dates))
