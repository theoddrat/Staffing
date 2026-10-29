"""Out-of-sample accuracy metrics (DESIGN.md §9.3). Every number here compares predictions made before
the fact with what actually happened; nothing is in-sample."""
from __future__ import annotations

from typing import Any

import numpy as np


def oos_stats(actual: np.ndarray, pred: np.ndarray, hit_threshold: float) -> dict[str, Any] | None:
    a = np.asarray(actual, dtype=float).ravel()
    p = np.asarray(pred, dtype=float).ravel()
    m = np.isfinite(a) & np.isfinite(p)
    if not m.any():
        return None
    a, p = a[m], p[m]
    e = a - p
    sse, sse0 = float(e @ e), float(a @ a)
    big = (np.abs(a) >= hit_threshold) & (p != 0)
    return {
        "rmse": float(np.sqrt(sse / len(a))),
        "mae": float(np.mean(np.abs(e))),
        "r2": (1.0 - sse / sse0) if sse0 > 0 else 0.0,
        "hit": float(np.mean(np.sign(p[big]) == np.sign(a[big]))) if big.any() else None,
        "n": int(len(a)),
    }


def xs_corr(A: np.ndarray, Pr: np.ndarray, rows: np.ndarray, min_stocks: int) -> float | None:
    """Mean over `rows` (days) of the cross-sectional correlation between predicted and actual moves."""
    vals = []
    for t in rows:
        a, p = A[t], Pr[t]
        m = np.isfinite(a) & np.isfinite(p)
        if m.sum() < min_stocks:
            continue
        aa, pp = a[m], p[m]
        if np.std(aa) <= 0 or np.std(pp) <= 0:
            continue
        vals.append(float(np.corrcoef(aa, pp)[0, 1]))
    return float(np.mean(vals)) if vals else None


def coverage(actual: np.ndarray, pred: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> tuple[float | None, int]:
    m = np.isfinite(actual) & np.isfinite(pred) & np.isfinite(lo) & np.isfinite(hi)
    if not m.any():
        return None, 0
    e = actual[m] - pred[m]
    inside = (e >= lo[m]) & (e <= hi[m])
    return float(np.mean(inside)), int(m.sum())


def event_metrics(actual: np.ndarray, pred: np.ndarray, hit_threshold: float, min_stocks: int) -> dict[str, Any]:
    m = np.isfinite(actual) & np.isfinite(pred)
    a, p = actual[m], pred[m]
    if len(a) == 0:
        return {"corr": None, "mae": float("nan"), "hit": None}
    corr = float(np.corrcoef(a, p)[0, 1]) if len(a) >= min_stocks and np.std(a) > 0 and np.std(p) > 0 else None
    big = (np.abs(a) >= hit_threshold) & (p != 0)
    return {"corr": corr, "mae": float(np.mean(np.abs(a - p))),
            "hit": float(np.mean(np.sign(p[big]) == np.sign(a[big]))) if big.any() else None}
