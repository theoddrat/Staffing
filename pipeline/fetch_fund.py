"""Cached yfinance fundamentals: info, fast_info, statements, earnings calendar.

Cache: .cache/fund/<safe ticker>/<kind>.pkl (+ .meta.json with fetched_at). Refreshed after
settings.fundamentals_cache_days. Polite throttling and exponential backoff on rate limits.
Returns None (never fabricated values) when Yahoo has nothing.
"""
from __future__ import annotations

import fcntl
import json
import os
import pickle
import random
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.prices import ROOT, _safe

warnings.filterwarnings("ignore")

FUND_DIR = ROOT / ".cache" / "fund"
FUND_DIR.mkdir(parents=True, exist_ok=True)
OFFLINE = os.environ.get("ACM_OFFLINE", "0") == "1"
MIN_DELAY_S = float(os.environ.get("ACM_FUND_DELAY_S", "0.8"))
_last = [0.0]

KINDS = (
    "info",
    "fast_info",
    "income_stmt",
    "quarterly_income_stmt",
    "quarterly_cashflow",
    "cashflow",
    "quarterly_balance_sheet",
    "earnings_dates",
)


def _throttle() -> None:
    wait = MIN_DELAY_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()


def _fetch_kind(ticker: str, kind: str, earnings_limit: int) -> Any:
    import yfinance as yf

    tk = yf.Ticker(ticker)
    if kind == "info":
        info = tk.info
        return dict(info) if info else None
    if kind == "fast_info":
        fi = tk.fast_info
        out = {}
        for k in ("lastPrice", "marketCap", "shares", "currency", "exchange", "quoteType"):
            try:
                out[k] = fi.get(k)
            except Exception:  # noqa: BLE001
                out[k] = None
        return out
    if kind == "earnings_dates":
        df = tk.get_earnings_dates(limit=earnings_limit)
        return df if df is not None and not df.empty else None
    df = getattr(tk, kind)
    return df if df is not None and not df.empty else None


def get_fund(ticker: str, kind: str, max_age_days: float = 3, earnings_limit: int = 80,
             refresh: bool = False, retries: int = 4) -> Any:
    d = FUND_DIR / _safe(ticker)
    d.mkdir(parents=True, exist_ok=True)
    pkl = d / f"{kind}.pkl"
    meta = d / f"{kind}.meta.json"
    lock = d / f"{kind}.lock"
    with open(lock, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            cached = None
            age_days = None
            if pkl.exists() and meta.exists():
                try:
                    with open(pkl, "rb") as fh:
                        cached = pickle.load(fh)
                    m = json.loads(meta.read_text())
                    fetched = datetime.fromisoformat(m["fetched_at"])
                    age_days = (datetime.now(timezone.utc) - fetched).total_seconds() / 86400
                except Exception:  # noqa: BLE001 - corrupt cache -> refetch
                    cached, age_days = None, None
            fresh_enough = age_days is not None and age_days <= max_age_days
            if OFFLINE or (fresh_enough and not refresh):
                return cached
            delay = 2.0
            for _ in range(retries):
                _throttle()
                try:
                    val = _fetch_kind(ticker, kind, earnings_limit)
                    with open(pkl, "wb") as fh:
                        pickle.dump(val, fh)
                    meta.write_text(json.dumps({"fetched_at": datetime.now(timezone.utc).isoformat()}))
                    return val
                except Exception as exc:  # noqa: BLE001
                    msg = str(exc)
                    if "404" in msg or "Not Found" in msg:
                        return cached
                    time.sleep(delay + random.random())
                    delay *= 2
            return cached
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def get_all(ticker: str, max_age_days: float = 3, earnings_limit: int = 80, kinds: tuple[str, ...] = KINDS) -> dict[str, Any]:
    return {k: get_fund(ticker, k, max_age_days=max_age_days, earnings_limit=earnings_limit) for k in kinds}


def load_cached(ticker: str) -> dict[str, Any]:
    """Cache-only read of every kind (no network)."""
    d = FUND_DIR / _safe(ticker)
    out: dict[str, Any] = {}
    for k in KINDS:
        pkl = d / f"{k}.pkl"
        if pkl.exists():
            try:
                with open(pkl, "rb") as fh:
                    out[k] = pickle.load(fh)
            except Exception:  # noqa: BLE001
                out[k] = None
        else:
            out[k] = None
    return out


def df_row(df: pd.DataFrame | None, names: list[str]) -> pd.Series | None:
    """First matching statement row (columns = period end dates), sorted ascending by date."""
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return None
    for n in names:
        if n in df.index:
            s = pd.to_numeric(df.loc[n], errors="coerce")
            s.index = pd.to_datetime(s.index)
            return s.sort_index()
    return None
