"""Calibration items the engine needs even if the history module is unavailable."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.config import computed_quantity


def _event_ar(r: pd.Series | None, rm: pd.Series | None, day: pd.Timestamp, est_days: int = 250, gap: int = 10) -> float | None:
    """Market-model abnormal return on `day` (alpha/beta from [-est_days, -gap-1])."""
    if r is None or rm is None:
        return None
    df = pd.concat([r.rename("r"), rm.rename("m")], axis=1).dropna()
    if day not in df.index:
        return None
    i = df.index.get_loc(day)
    lo, hi = max(0, i - est_days), max(0, i - gap)
    est = df.iloc[lo:hi]
    if len(est) < 60:
        return float(df["r"].iloc[i] - df["m"].iloc[i])
    b = np.polyfit(est["m"].to_numpy(), est["r"].to_numpy(), 1)
    return float(df["r"].iloc[i] - (b[1] + b[0] * df["m"].iloc[i]))


def contagion_fallback(logret: Any) -> dict[str, Any]:
    """US: SMCI auditor resignation (30-Oct-2024); India: Satyam (7-Jan-2009, Satyam move SOURCED -78%)."""
    out: dict[str, Any] = {}
    day = pd.Timestamp("2024-10-30")
    spx = logret("^GSPC")
    ar_smci = _event_ar(logret("SMCI"), spx, day)
    peers = ["NVDA", "AMD", "AVGO", "MRVL", "MU", "ARM", "TSM", "ASML", "INTC"]
    ars = [a for a in (_event_ar(logret(p), spx, day) for p in peers) if a is not None]
    ratio = None
    if ar_smci is not None and ar_smci < 0 and ars:
        ratio = max(0.0, float(np.mean(ars)) / ar_smci)
    out["contagion_us"] = computed_quantity(
        "calib.contagion_us", "Contagion ratio: mean AI-hardware peer abnormal return / SMCI abnormal return (30-Oct-2024)",
        ratio, "x", note="market model vs S&P 500; SMCI disclosed EY's resignation on 30-Oct-2024 (fallback computed by core)",
        bounds=(0.0, 1.0, 0.01), src=["smci_ey_2024"])
    day_in = pd.Timestamp("2009-01-07")
    nifty = logret("^NSEI")
    it = ["INFY.NS", "TCS.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS"]
    ars_in = [a for a in (_event_ar(logret(p), nifty, day_in) for p in it) if a is not None]
    ratio_in = None
    satyam_move = np.log(1 - 0.78)  # SOURCED: shares fell ~78% on 7-Jan-2009 (Bloomberg)
    if ars_in:
        ratio_in = max(0.0, float(np.mean(ars_in)) / satyam_move)
    out["contagion_india"] = computed_quantity(
        "calib.contagion_india", "Contagion ratio: mean Indian IT peer abnormal return / Satyam move (7-Jan-2009)",
        ratio_in, "x", note="peers INFY/TCS/WIPRO/HCLTECH/TECHM vs Nifty 50; Satyam fell ~78% on the day (SOURCED); fallback computed by core",
        bounds=(0.0, 1.0, 0.01))
    if ratio_in is not None:
        out["contagion_india"]["status"] = "SOURCED"
    return out


def tier_median_premium(india: list[dict[str, Any]], securities: dict[str, dict[str, Any]]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for tier in ("A", "B", "C", "D"):
        vals = [securities.get(t["ticker"], {}).get("ai_premium") for t in india if t["tier"] == tier]
        vals = [v for v in vals if v is not None]
        out[tier] = float(np.median(vals)) if vals else None
    return out
