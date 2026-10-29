"""Pooled gradient-boosted trees (evaluation only; DESIGN.md §9.2). One model for all stocks, refitted every
`gbm_refit_every` sessions on the trailing training window. Point-in-time features (trailing betas and
volatility) use only sessions before the row they describe, so nothing leaks from the future."""
from __future__ import annotations

import time
from typing import Callable

import numpy as np
import pandas as pd

from pipeline.modellab.panel import Panel
from pipeline.modellab.settings import LabSettings
from pipeline.modellab.walkforward import WF

TIER_CODE = {"A": 0, "B": 1, "C": 2, "D": 3}


def pit_beta(y: np.ndarray, x: np.ndarray, win: int, min_obs: int) -> np.ndarray:
    """Trailing beta of y on x over `win` rows ending the row BEFORE each row."""
    ys = pd.Series(y)
    xs = pd.Series(x).where(ys.notna())
    cov = ys.rolling(win, min_periods=min_obs).cov(xs)
    var = xs.rolling(win, min_periods=min_obs).var()
    return (cov / var).shift(1).to_numpy(dtype=float)


def pit_vol(y: np.ndarray, win: int, min_obs: int) -> np.ndarray:
    return pd.Series(y).rolling(win, min_periods=min_obs).std().shift(1).to_numpy(dtype=float)


def feature_cube(P: Panel, st: LabSettings, nowcast: bool) -> tuple[list[str], np.ndarray]:
    """T x N x K feature array."""
    T, N = P.T, P.N
    win, mo = st.gbm_feature_window, st.gbm_feature_min_obs
    rb_s = np.column_stack([pit_beta(P.Y[:, i], P.F["SOX"][:, i], win, mo) for i in range(N)])
    rb_d = np.column_stack([pit_beta(P.Y[:, i], P.F["NDX"][:, i], win, mo) for i in range(N)])
    rv = np.column_stack([pit_vol(P.Y[:, i], win, mo) for i in range(N)])
    tier = np.broadcast_to(np.array([TIER_CODE[t] for t in P.tiers], dtype=float), (T, N))
    names = ["SOX", "NDX", "PARENT", "tier", "beta_SOX", "beta_NDX", "vol", "beta_SOX_x_SOX", "beta_NDX_x_NDX"]
    cols = [P.F["SOX"], P.F["NDX"], P.F["PARENT"], tier, rb_s, rb_d, rv, rb_s * P.F["SOX"], rb_d * P.F["NDX"]]
    if nowcast:
        extra = [a for a in P.aux_ids] + ["ADR", "Y_L1", "NIFTY_L1"]
        names += extra
        cols += [P.F[a] for a in extra]
        if "INDA" in P.F:
            rb_i = np.column_stack([pit_beta(P.Y[:, i], P.F["INDA"][:, i], win, mo) for i in range(N)])
            names += ["beta_INDA", "beta_INDA_x_INDA"]
            cols += [rb_i, rb_i * P.F["INDA"]]
    return names, np.stack(cols, axis=-1)


def run_gbm(P: Panel, wf: WF, st: LabSettings, log: Callable[[str], None] = print) -> None:
    from sklearn.ensemble import HistGradientBoostingRegressor

    T, N = P.T, P.N
    W = st.train_sessions
    step = max(1, st.gbm_refit_every // st.refit_every)
    starts = list(range(0, len(wf.refits), step))
    is_in = np.array([m == "IN" for m in P.markets])
    for model_id, nowcast in (("gbm", False), ("gbm_now", True)):
        t0 = time.time()
        names, Xc = feature_cube(P, st, nowcast)
        cat = np.array([n == "tier" for n in names])
        pr = np.full((T, N), np.nan)
        need = [j for j, n in enumerate(names) if n not in ("PARENT", "ADR")]  # these may be missing (trees handle NaN)
        for q, k in enumerate(starts):
            R = wf.refits[k]
            k_end = starts[q + 1] if q + 1 < len(starts) else len(wf.refits)
            a, b = R, wf.bounds[k_end - 1]
            if b <= a:
                continue
            tr = slice(max(0, R - W), R)
            Xt = Xc[tr].reshape(-1, len(names))
            yt = P.Y[tr].reshape(-1)
            stock_ok = np.broadcast_to(is_in if nowcast else np.ones(N, dtype=bool), (R - max(0, R - W), N)).reshape(-1)
            ok = np.isfinite(yt) & np.all(np.isfinite(Xt[:, need]), axis=1) & stock_ok
            if ok.sum() < st.min_train_obs * 4:
                continue
            g = HistGradientBoostingRegressor(categorical_features=cat, random_state=0, early_stopping=False, **st.gbm)
            g.fit(Xt[ok], yt[ok])
            Xb = Xc[a:b]
            fit_mask = wf.fitted[wf.block_of[a:b]] & (is_in[None, :] if nowcast else True)  # same availability as the zoo
            okb = np.all(np.isfinite(Xb[:, :, need]), axis=-1) & fit_mask
            if okb.any():
                rows, cols = np.nonzero(okb)
                pr[a + rows, cols] = g.predict(Xb[rows, cols])
        wf.preds[model_id] = pr
        log(f"[modellab] {model_id}: {len(starts)} pooled fits in {time.time() - t0:.1f}s")
