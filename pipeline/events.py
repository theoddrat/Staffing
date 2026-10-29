"""Pure, network-free building blocks for the history panel (drawdowns, event studies, helpers).

All functions take pandas objects and return plain dicts/lists that are JSON-safe after `json_safe`.
Conventions (docs/DESIGN.md): log returns for CAR/regressions, simple returns for drawdowns,
trading-day counts on the series' own calendar.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np
import pandas as pd

STATUS_RANK = {"COMPUTED": 0, "SOURCED": 1, "DERIVED": 1, "UNVERIFIED": 2, "USER_ASSUMPTION": 3}

PRE_DAYS = 5
POST_DAYS = 60
EST_WINDOW = (-250, -11)
MIN_EST_OBS = 120


# ----------------------------------------------------------------------------- JSON helpers
def json_safe(obj: Any) -> Any:
    """Recursively convert numpy/pandas scalars to Python and NaN/inf to None."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, (pd.Timestamp,)):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, np.ndarray):
        return [json_safe(v) for v in obj.tolist()]
    return obj


def fnum(x: Any, nd: int | None = None) -> float | None:
    """Finite float or None (optionally rounded)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return round(v, nd) if nd is not None else v


def ds(d: Any) -> str | None:
    if d is None or (isinstance(d, float) and not math.isfinite(d)):
        return None
    return pd.Timestamp(d).strftime("%Y-%m-%d")


def worst_status(statuses: Iterable[str]) -> str:
    st = [s for s in statuses if s]
    if not st:
        return "COMPUTED"
    return max(st, key=lambda s: STATUS_RANK.get(s, 0))


def quantity(
    qid: str,
    label: str,
    parts: list[dict[str, Any]],
    unit: str = "frac",
    note: str | None = None,
    editable: bool = True,
    vmin: float | None = None,
    vmax: float | None = None,
    step: float | None = None,
) -> dict[str, Any]:
    """Quantity dict (src/types/data.ts). value = product of part values; status = worst part."""
    value: float | None = 1.0
    for p in parts:
        pv = fnum(p.get("value"))
        if pv is None:
            value = None
            break
        value *= pv
    src: list[str] = []
    for p in parts:
        for s in p.get("src", []) or []:
            if s not in src:
                src.append(s)
    return {
        "id": qid,
        "label": label,
        "value": fnum(value),
        "unit": unit,
        "status": worst_status(p.get("status", "COMPUTED") for p in parts),
        "parts": [
            {
                "label": p["label"],
                "value": fnum(p.get("value")),
                "status": p.get("status", "COMPUTED"),
                "src": list(p.get("src", []) or []),
                "note": p.get("note"),
            }
            for p in parts
        ],
        "src": src,
        "note": note,
        "editable": editable,
        "min": vmin,
        "max": vmax,
        "step": step,
    }


# ----------------------------------------------------------------------------- series helpers
def close_series(df: pd.DataFrame | None, col: str = "Close") -> pd.Series | None:
    if df is None or df.empty or col not in df:
        return None
    s = df[col].astype(float)
    s = s[np.isfinite(s) & (s > 0)]
    s.index = pd.to_datetime(s.index)
    return s.sort_index() if not s.empty else None


def log_returns(s: pd.Series | None) -> pd.Series | None:
    if s is None or s.empty:
        return None
    r = np.log(s).diff().dropna()
    return r if not r.empty else None


def value_on_or_before(s: pd.Series, date: Any) -> tuple[pd.Timestamp | None, float | None]:
    d = pd.Timestamp(date)
    sub = s.loc[:d]
    if sub.empty:
        return None, None
    return sub.index[-1], float(sub.iloc[-1])


def first_on_or_after(index: pd.DatetimeIndex, date: Any, strict: bool = False) -> int | None:
    d = pd.Timestamp(date)
    pos = int(index.searchsorted(d, side="right" if strict else "left"))
    return pos if pos < len(index) else None


# ----------------------------------------------------------------------------- drawdowns
def drawdown(
    s: pd.Series | None,
    peak_start: Any,
    peak_end: Any,
    trough_end: Any,
    recover_end: Any | None = None,
) -> dict[str, Any] | None:
    """Peak (max in [peak_start, peak_end]) -> trough (min after peak up to trough_end) -> recovery.

    days_* are trading-day counts on the series' own calendar. Returns None if the series does not
    cover the peak window.
    """
    if s is None or s.empty:
        return None
    s = s.sort_index()
    ps, pe, te = pd.Timestamp(peak_start), pd.Timestamp(peak_end), pd.Timestamp(trough_end)
    win = s.loc[ps:pe]
    if win.empty:
        return None
    peak_date = win.idxmax()
    peak = float(win.max())
    after = s.loc[peak_date:te].iloc[1:]
    if after.empty:
        return None
    trough_date = after.idxmin()
    trough = float(after.min())
    pos = s.index.get_indexer([peak_date, trough_date])
    days_to_bottom = int(pos[1] - pos[0])
    rec = s.loc[trough_date:]
    if recover_end is not None:
        rec = rec.loc[: pd.Timestamp(recover_end)]
    hit = rec[rec >= peak]
    recovered_date = hit.index[0] if not hit.empty else None
    days_to_recover = None
    if recovered_date is not None:
        days_to_recover = int(s.index.get_indexer([recovered_date])[0] - pos[1])
    notes = []
    first = s.index[0]
    if first > ps:
        notes.append(f"series begins {ds(first)}; the true peak may be earlier")
    return {
        "peak_date": ds(peak_date),
        "peak": fnum(peak, 6),
        "trough_date": ds(trough_date),
        "trough": fnum(trough, 6),
        "drawdown": fnum(trough / peak - 1.0, 6),
        "days_to_bottom": days_to_bottom,
        "days_to_recover": days_to_recover,
        "recovered_date": ds(recovered_date) if recovered_date is not None else None,
        "_notes": notes,
    }


# ----------------------------------------------------------------------------- regressions
def ols_fit(x: np.ndarray, y: np.ndarray) -> dict[str, float] | None:
    """Simple OLS y = a + b x. Returns slope, intercept, r2, n (None if < 3 obs or no variance)."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    n = int(len(x))
    if n < 3 or np.var(x) == 0:
        return None
    b, a = np.polyfit(x, y, 1)
    yhat = a + b * x
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return {"slope": float(b), "intercept": float(a), "r2": float(r2), "n": n}


# ----------------------------------------------------------------------------- event studies
def joint_returns(r_stock: pd.Series, r_index: pd.Series) -> pd.DataFrame:
    df = pd.concat({"r": r_stock, "m": r_index}, axis=1, join="inner").dropna()
    return df.sort_index()


def estimate_beta(
    df: pd.DataFrame, lo: int, hi: int, min_obs: int = MIN_EST_OBS
) -> tuple[float, float | None, str]:
    """Beta of r on m over joint rows [lo, hi] (OLS with intercept).

    Returns (beta, alpha_estimate, method). Fewer than `min_obs` rows (or no variance) ->
    (1.0, None, 'market_adjusted').
    """
    lo = max(0, lo)
    if hi < lo:
        return 1.0, None, "market_adjusted"
    e = df.iloc[lo : hi + 1]
    if len(e) < min_obs:
        return 1.0, None, "market_adjusted"
    fit = ols_fit(e["m"].to_numpy(), e["r"].to_numpy())
    if fit is None:
        return 1.0, None, "market_adjusted"
    return fit["slope"], fit["intercept"], "market_model"


def market_model_car(
    r_stock: pd.Series | None,
    r_index: pd.Series | None,
    event_date: Any,
    day0: str = "same",
    pre: int = PRE_DAYS,
    post: int = POST_DAYS,
    est: tuple[int, int] = EST_WINDOW,
    min_obs: int = MIN_EST_OBS,
) -> dict[str, Any] | None:
    """CAR path from -pre..+post (log abnormal returns, cumulative from day -pre).

    day0='same' -> first joint trading date on/after event_date; 'next' -> strictly after.
    Zero-alpha market model: beta from OLS (with intercept) on [est[0], est[1]] relative to day 0,
    AR_t = r_t - beta * r_m,t (the estimated alpha is dropped so a bubble-era run-up in the
    estimation window does not leak into post-event CARs). Market-adjusted (beta = 1) when fewer
    than `min_obs` estimation days exist.
    """
    if r_stock is None or r_index is None:
        return None
    df = joint_returns(r_stock, r_index)
    if df.empty:
        return None
    p0 = first_on_or_after(df.index, event_date, strict=(day0 == "next"))
    if p0 is None:
        return None
    # Event must fall within a few days of the requested date (avoid jumping over long gaps).
    if (df.index[p0] - pd.Timestamp(event_date)).days > 10:
        return None
    if p0 - pre < 0:
        return None
    beta, alpha_est, method = estimate_beta(df, p0 + est[0], p0 + est[1], min_obs)
    car: list[float | None] = []
    ars: list[float | None] = []
    cum = 0.0
    for k in range(-pre, post + 1):
        p = p0 + k
        if p >= len(df):
            car.append(None)
            ars.append(None)
            continue
        row = df.iloc[p]
        ar = float(row["r"] - beta * row["m"])
        cum += ar
        ars.append(ar)
        car.append(cum)
    last = next((c for c in reversed(car) if c is not None), None)
    return {
        "day0_date": ds(df.index[p0]),
        "car": [fnum(c, 6) for c in car],
        "ar0": fnum(ars[pre], 6),
        "ar1": fnum(ars[pre + 1], 6) if len(ars) > pre + 1 else None,
        "car_end": fnum(last, 6),
        "method": method,
        "alpha_est": fnum(alpha_est),
        "beta": fnum(beta),
    }


def abnormal_return(
    r_stock: pd.Series | None,
    r_index: pd.Series | None,
    date: Any,
    est_anchor: Any | None = None,
    est: tuple[int, int] = EST_WINDOW,
    min_obs: int = MIN_EST_OBS,
) -> dict[str, Any] | None:
    """Single-day log abnormal return on `date` (exact joint trading date required).

    Same zero-alpha market model as `market_model_car`; estimation window positions are relative
    to `est_anchor` (default: `date`).
    """
    if r_stock is None or r_index is None:
        return None
    df = joint_returns(r_stock, r_index)
    d = pd.Timestamp(date)
    if d not in df.index:
        return None
    anchor = pd.Timestamp(est_anchor) if est_anchor is not None else d
    pa = first_on_or_after(df.index, anchor)
    if pa is None:
        return None
    beta, alpha_est, method = estimate_beta(df, pa + est[0], pa + est[1], min_obs)
    row = df.loc[d]
    ar = float(row["r"] - beta * row["m"])
    return {"ar": ar, "r": float(row["r"]), "m": float(row["m"]), "alpha_est": alpha_est, "beta": beta, "method": method}


def mean_path(paths: list[list[float | None]]) -> list[float | None]:
    if not paths:
        return []
    n = max(len(p) for p in paths)
    out: list[float | None] = []
    for i in range(n):
        vals = [p[i] for p in paths if i < len(p) and p[i] is not None]
        out.append(fnum(float(np.mean(vals)), 6) if vals else None)
    return out


# ----------------------------------------------------------------------------- windows
def worst_window(r: pd.Series | None, h: int) -> tuple[float | None, str | None]:
    """Most negative h-day cumulative log return and the end date of that window."""
    if r is None or r.empty or len(r) < h:
        return None, None
    roll = r.rolling(h).sum().dropna() if h > 1 else r
    if roll.empty:
        return None, None
    d = roll.idxmin()
    return fnum(float(roll.min()), 6), ds(d)


def index_to_peak(s: pd.Series, peak_date: Any, span_before: int, span_after: int) -> dict[str, Any]:
    """Series indexed to 100 at `peak_date`; t = trading days relative to the peak."""
    s = s.sort_index()
    pos = int(s.index.get_indexer([pd.Timestamp(peak_date)])[0])
    lo, hi = max(0, pos - span_before), min(len(s) - 1, pos + span_after)
    peak = float(s.iloc[pos])
    sub = s.iloc[lo : hi + 1]
    t = list(range(lo - pos, hi - pos + 1))
    v = [round(float(x) / peak * 100.0, 3) for x in sub.to_numpy()]
    return {"t": t, "v": v}


def log_move(s: pd.Series | None, start: Any, end: Any) -> float | None:
    """ln(C[last on/before end] / C[last on/before start])."""
    if s is None or s.empty:
        return None
    d0, c0 = value_on_or_before(s, start)
    d1, c1 = value_on_or_before(s, end)
    if d0 is None or d1 is None or c0 is None or c1 is None or d1 <= d0:
        return None
    # Guard against a stale start (series did not exist yet at `start`).
    if (pd.Timestamp(start) - d0).days > 10:
        return None
    return fnum(math.log(c1 / c0), 6)


def log_move_next_after(s: pd.Series | None, start: Any, end: Any) -> float | None:
    """ln(C[first close strictly after end] / C[last on/before start]) — India reaction to a US window."""
    if s is None or s.empty:
        return None
    d0, c0 = value_on_or_before(s, start)
    if d0 is None or (pd.Timestamp(start) - d0).days > 10:
        return None
    p1 = first_on_or_after(s.index, end, strict=True)
    if p1 is None:
        return None
    d1 = s.index[p1]
    if (d1 - pd.Timestamp(end)).days > 10:
        return None
    return fnum(math.log(float(s.iloc[p1]) / c0), 6)


def day_return(s: pd.Series | None, date: Any) -> float | None:
    """Simple close-to-close return on exactly `date` (None if not a trading day)."""
    if s is None or s.empty:
        return None
    d = pd.Timestamp(date)
    if d not in s.index:
        return None
    pos = int(s.index.get_indexer([d])[0])
    if pos == 0:
        return None
    return fnum(float(s.iloc[pos]) / float(s.iloc[pos - 1]) - 1.0, 6)
