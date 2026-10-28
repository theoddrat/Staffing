"""Shared, cached daily price download (yfinance). Used by every pipeline module.

Cache: .cache/prices/<safe ticker>.csv  (one file per ticker, full history).
Columns: Date (YYYY-MM-DD, exchange-local trading date), Open, High, Low, Close, AdjClose, Volume.
`Close` is split-adjusted only (use for P/E); `AdjClose` is split+dividend adjusted (use for returns).

Concurrency-safe across processes via a per-ticker lock file, polite delay between network calls,
exponential backoff on HTTP 429 / transient errors. Never fabricates data: returns None on failure.
"""
from __future__ import annotations

import fcntl
import os
import random
import time
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / ".cache" / "prices"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Refresh a cached file if its last row is older than this many calendar days vs today (UTC).
STALE_DAYS = int(os.environ.get("ACM_PRICE_STALE_DAYS", "3"))
# Set ACM_OFFLINE=1 to never touch the network (use cache only).
OFFLINE = os.environ.get("ACM_OFFLINE", "0") == "1"
MIN_DELAY_S = float(os.environ.get("ACM_MIN_DELAY_S", "0.6"))

_last_call = [0.0]


def _safe(ticker: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else f"_{ord(c):x}_" for c in ticker)


def cache_path(ticker: str) -> Path:
    return CACHE_DIR / f"{_safe(ticker)}.csv"


def _throttle() -> None:
    wait = MIN_DELAY_S - (time.time() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.time()


def _download(ticker: str, retries: int = 5) -> pd.DataFrame | None:
    import yfinance as yf  # imported lazily so tests never need the network

    delay = 2.0
    for attempt in range(retries):
        _throttle()
        try:
            h = yf.Ticker(ticker).history(period="max", auto_adjust=False, actions=False)
            if h is None or h.empty:
                return None
            idx = pd.to_datetime(h.index)
            if getattr(idx, "tz", None) is not None:
                idx = idx.tz_localize(None)  # keep exchange-local calendar date
            df = pd.DataFrame(
                {
                    "Date": idx.strftime("%Y-%m-%d"),
                    "Open": h["Open"].to_numpy(),
                    "High": h["High"].to_numpy(),
                    "Low": h["Low"].to_numpy(),
                    "Close": h["Close"].to_numpy(),
                    "AdjClose": (h["Adj Close"] if "Adj Close" in h else h["Close"]).to_numpy(),
                    "Volume": (h["Volume"] if "Volume" in h else pd.Series(0, index=h.index)).to_numpy(),
                }
            )
            df = df.dropna(subset=["Close"]).drop_duplicates("Date", keep="last").sort_values("Date")
            return df.reset_index(drop=True)
        except Exception as exc:  # noqa: BLE001 - network layer, retry
            msg = str(exc)
            if "delisted" in msg.lower() or "no timezone" in msg.lower():
                return None
            time.sleep(delay + random.random())
            delay *= 2
    return None


def get_history(ticker: str, refresh: bool = False) -> pd.DataFrame | None:
    """Full daily history for `ticker` with a DatetimeIndex (tz-naive local dates), or None."""
    path = cache_path(ticker)
    lock_path = path.with_suffix(".lock")
    with open(lock_path, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            df = None
            if path.exists():
                df = pd.read_csv(path)
                if df.empty:
                    df = None
            need = refresh or df is None
            if df is not None and not need and not OFFLINE:
                last = datetime.strptime(str(df["Date"].iloc[-1]), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - last > timedelta(days=STALE_DAYS):
                    need = True
            if need and not OFFLINE:
                fresh = _download(ticker)
                if fresh is not None and not fresh.empty:
                    fresh.to_csv(path, index=False)
                    df = fresh
            if df is None or df.empty:
                return None
            out = df.copy()
            out.index = pd.to_datetime(out.pop("Date"))
            out.index.name = "Date"
            return out
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def log_returns(df: pd.DataFrame | None, col: str = "AdjClose") -> pd.Series | None:
    """Daily log returns on the security's own trading calendar (first row dropped)."""
    import numpy as np

    if df is None or df.empty:
        return None
    s = df[col].astype(float)
    s = s[s > 0]
    r = np.log(s).diff().dropna()
    return r
