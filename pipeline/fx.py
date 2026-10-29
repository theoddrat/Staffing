"""Layer-4 FX calibration: INR response to US tech selloffs (DESIGN.md §3.5)."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline import stats
from pipeline.config import computed_quantity


def window_move(close: pd.Series | None, start: str, end: str) -> float | None:
    """Log change from the close on/just before `start` to the close on/just before `end`."""
    if close is None:
        return None
    c = close.dropna()
    a = c[c.index <= pd.Timestamp(start)]
    b = c[c.index <= pd.Timestamp(end)]
    if a.empty or b.empty or b.index[-1] <= a.index[-1]:
        return None
    return float(np.log(b.iloc[-1] / a.iloc[-1]))


def fx_calibration(est: Any, closes: dict[str, pd.Series | None], episodes_cfg: list[dict[str, Any]]) -> dict[str, Any]:
    r_fx = est.logret("USDINR=X")
    out: dict[str, Any] = {"beta_inr_on_ndx": 0.0, "beta_inr_on_ndx_down": None, "r2": 0.0, "n": 0, "episodes": []}
    if r_fx is not None and not r_fx.empty:
        dates = pd.DatetimeIndex(r_fx.index)
        x0 = est.aligned("^NDX", dates, "FX", "FX")
        df = pd.DataFrame({"y": r_fx, "N0": x0, "N1": x0.shift(1)})
        a, b = est.window
        df = df[(df.index >= a) & (df.index <= b)].dropna()
        reg = stats.ols(df["y"], df[["N0", "N1"]], int(est.s.get("hac_lags", 5)), "dln USDINR on NDX (Dimson 0+1)")
        if reg is not None:
            out["beta_inr_on_ndx"] = reg["coef"]["N0"]["b"] + reg["coef"]["N1"]["b"]
            out["r2"] = reg["r2"]
            out["n"] = reg["n"]
        tot = df["N0"] + df["N1"]
        m = stats.downside_mask(tot, float(est.s.get("downside_quantile", 0.05)))
        if m.sum() >= int(est.s.get("downside_min_obs", 25)):
            rd = stats.ols(df.loc[m, "y"], df.loc[m, ["N0", "N1"]], int(est.s.get("hac_lags", 5)), "downside")
            if rd is not None:
                out["beta_inr_on_ndx_down"] = rd["coef"]["N0"]["b"] + rd["coef"]["N1"]["b"]
    eps = []
    for e in episodes_cfg or []:
        eps.append({
            "id": e["id"],
            "label": e["label"],
            "start": e["start"],
            "end": e["end"],
            "inr_depr": window_move(closes.get("USDINR=X"), e["start"], e["end"]),
            "ndx": window_move(closes.get("^NDX"), e["start"], e["end"]),
            "sox": window_move(closes.get("^SOX"), e["start"], e["end"]),
            "nifty": window_move(closes.get("^NSEI"), e["start"], e["end"]),
            "src": list(e.get("src", []) or []),
        })
    out["episodes"] = eps
    risk_off = [x["inr_depr"] for x in eps if x["inr_depr"] is not None and x["ndx"] is not None and x["ndx"] < 0]
    med = float(np.median(risk_off)) if risk_off else None
    out["default_f"] = computed_quantity(
        "fx.default_f",
        "INR depreciation in past US tech risk-off episodes (median, log change of USDINR)",
        med, "frac",
        note=f"median over {len(risk_off)} episodes with a falling Nasdaq-100 (episode windows are definitional)",
        bounds=(0.0, 0.2, 0.005),
    )
    return out
