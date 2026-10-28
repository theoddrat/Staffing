"""Robert Shiller's monthly S&P Composite data (ie_data.xls): download, parse, bubble episodes.

Source: http://www.econ.yale.edu/~shiller/data/ie_data.xls (cached in .cache/shiller/).
Every figure derived here is COMPUTED (source id `hist_shiller_ie`).
"""
from __future__ import annotations

import math
import os
import time
import urllib.request
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.events import ds, fnum

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "shiller"
DEFAULT_URL = "http://www.econ.yale.edu/~shiller/data/ie_data.xls"
MAX_AGE_DAYS = 30


def fetch_shiller(url: str = DEFAULT_URL, refresh: bool = False) -> Path | None:
    """Download ie_data.xls into the cache (re-download when older than MAX_AGE_DAYS)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "ie_data.xls"
    fresh = path.exists() and (time.time() - path.stat().st_mtime) < MAX_AGE_DAYS * 86400
    if path.exists() and (fresh or os.environ.get("ACM_OFFLINE") == "1") and not refresh:
        return path
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - fixed public URL
            data = resp.read()
        if len(data) < 100_000 or not data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            raise ValueError("unexpected response (not an .xls file)")
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
        return path
    except Exception:  # noqa: BLE001 - offline / blocked -> fall back to cache
        return path if path.exists() else None


def _parse_date(x: Any) -> pd.Timestamp | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v < 1800:
        return None
    y = int(math.floor(v))
    m = int(round((v - y) * 100))
    if not 1 <= m <= 12:
        return None
    return pd.Timestamp(year=y, month=m, day=1)


def parse_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Normalise the 'Data' sheet (header row 7) to month-indexed columns P, E, CPI, real_price, CAPE."""
    cols = {c: str(c).strip() for c in raw.columns}
    raw = raw.rename(columns=cols)
    out = pd.DataFrame(
        {
            "date": raw["Date"].map(_parse_date),
            "P": pd.to_numeric(raw.get("P"), errors="coerce"),
            "E": pd.to_numeric(raw.get("E"), errors="coerce"),
            "CPI": pd.to_numeric(raw.get("CPI"), errors="coerce"),
            "real_price": pd.to_numeric(raw.get("Price"), errors="coerce"),
            "CAPE": pd.to_numeric(raw.get("CAPE"), errors="coerce"),
        }
    )
    out = out.dropna(subset=["date", "P"]).drop_duplicates("date").set_index("date").sort_index()
    return out


def load_shiller(path: Path | None) -> pd.DataFrame | None:
    if path is None or not Path(path).exists():
        return None
    raw = pd.read_excel(path, sheet_name="Data", header=7, engine="xlrd")
    df = parse_frame(raw)
    return df if not df.empty else None


def episode(df: pd.DataFrame, spec: dict[str, Any], src_id: str) -> dict[str, Any] | None:
    """One PeDrawdownPoint (src/types/data.ts) for a Shiller episode spec."""
    ps, pe = pd.Timestamp(spec["peak_search"][0] + "-01"), pd.Timestamp(spec["peak_search"][1] + "-01")
    te = pd.Timestamp(spec["trough_end"] + "-01")
    win = df.loc[ps:pe, "P"].dropna()
    if win.empty:
        return None
    peak_date = win.idxmax()
    p_peak = float(win.max())
    after = df.loc[peak_date:te].iloc[1:]
    if after.empty:
        return None
    trough_date = after["P"].idxmin()
    p_trough = float(after["P"].min())
    e_hist = df.loc[:peak_date, "E"].dropna()
    if e_hist.empty or e_hist.iloc[-1] <= 0:
        return None
    pe_trailing = p_peak / float(e_hist.iloc[-1])
    cape = df.loc[peak_date, "CAPE"]
    real_peak = df.loc[peak_date, "real_price"]
    real_after = after["real_price"].dropna()
    real_dd = None
    if np.isfinite(real_peak) and not real_after.empty:
        real_dd = float(real_after.min()) / float(real_peak) - 1.0
    months = int(len(df.loc[peak_date:trough_date]) - 1)
    note = (
        f"Monthly-average prices. Peak {peak_date:%Y-%m}, trough {trough_date:%Y-%m} ({months} months); "
        f"trailing P/E {pe_trailing:.1f}"
        + (f", CAPE {float(cape):.1f}" if cape is not None and np.isfinite(cape) else "")
        + (f"; real drawdown {real_dd * 100:.1f}%" if real_dd is not None else "")
        + "."
    )
    return {
        "id": spec["id"],
        "label": spec.get("label", spec["id"]),
        "market": "US",
        "peak_date": ds(peak_date),
        "pe": fnum(pe_trailing, 3),
        "pe_kind": "trailing",
        "pe_status": "COMPUTED",
        "drawdown": fnum(p_trough / p_peak - 1.0, 6),
        "drawdown_status": "COMPUTED",
        "src": [src_id],
        "note": note,
        "_cape": fnum(cape, 3),
        "_real_drawdown": fnum(real_dd, 6),
        "_trough_date": ds(trough_date),
    }


def episodes(df: pd.DataFrame | None, specs: list[dict[str, Any]], src_id: str) -> list[dict[str, Any]]:
    if df is None:
        return []
    out = []
    for spec in specs:
        pt = episode(df, spec, src_id)
        if pt is not None:
            out.append(pt)
    return out
