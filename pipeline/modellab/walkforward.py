"""Walk-forward engine (DESIGN.md §9.3): refit every `refit_every` sessions on the trailing
`train_sessions`, forecast the next block out of sample, then stack and calibrate.

Scenario mode: a model only sees the factor moves (SOX, NDX, the parent) plus the Nifty move implied
by the Nifty model fitted on the same window (reduced form). Predictions exclude the intercept, exactly
as the scenario engine applies the coefficients. Nowcast mode: ridge on every signal known before the
NSE close (`nowcast`) or before the NSE open (`nowcast_pre`).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd

from pipeline.modellab import fit
from pipeline.modellab.panel import Panel, ns
from pipeline.modellab.settings import LabSettings

LINEAR = ("ols", "ols_rf", "dimson", "shrink", "ewma", "asym", "huber")
STRUCT = ("SOX_DN", "SOX_UP", "NDX", "PARENT", "NIFTY")
COEF_NAMES = ("SOX", "NDX", "PARENT", "NIFTY")


def cols_for(model: str, with_parent: bool) -> list[str]:
    p = ["PARENT"] if with_parent else []
    if model in ("ols", "ewma", "huber", "shrink"):
        return ["SOX", "NDX", *p, "NIFTY"]
    if model == "ols_rf":
        return ["SOX", "NDX", *p]
    if model == "dimson":
        return ["SOX", "SOX_L1", "NDX", "NDX_L1", *(["PARENT", "PARENT_L1"] if with_parent else []), "NIFTY"]
    if model == "asym":
        return ["SOXm", "SOXp", "NDX", *p, "NIFTY"]
    raise KeyError(model)


def matrix(F: dict[str, np.ndarray], i: int, rows: np.ndarray, cols: list[str], pn: np.ndarray | None = None) -> np.ndarray:
    """Design matrix with intercept; with `pn` the NIFTY column is replaced by the model-implied Nifty move."""
    out = [np.ones(len(rows))]
    for c in cols:
        if c == "SOXm":
            out.append(np.minimum(F["SOX"][rows, i], 0.0))
        elif c == "SOXp":
            out.append(np.maximum(F["SOX"][rows, i], 0.0))
        elif c == "NIFTY" and pn is not None:
            out.append(pn)
        else:
            out.append(F[c][rows, i])
    return np.column_stack(out)


def struct(model: str, cols: list[str], b: np.ndarray) -> np.ndarray:
    """Scenario coefficients (SOX on down days, SOX on up days, NDX, PARENT, NIFTY) of a linear model."""
    d = dict(zip(cols, b[1:]))
    par = np.nan
    if model == "dimson":
        dn = up = d["SOX"] + d["SOX_L1"]
        ndx = d["NDX"] + d["NDX_L1"]
        if "PARENT" in d:
            par = d["PARENT"] + d["PARENT_L1"]
    elif model == "asym":
        dn, up, ndx = d["SOXm"], d["SOXp"], d["NDX"]
        par = d.get("PARENT", np.nan)
    else:
        dn = up = d["SOX"]
        ndx = d["NDX"]
        par = d.get("PARENT", np.nan)
    return np.array([dn, up, ndx, par, d.get("NIFTY", 0.0)], dtype=float)


def struct_predict(s: np.ndarray, sox: np.ndarray, ndx: np.ndarray, par: np.ndarray | None, pn: np.ndarray) -> np.ndarray:
    """Reduced-form prediction from scenario coefficients (sign-dependent SOX slope)."""
    out = np.where(sox < 0, s[0], s[1]) * sox + s[2] * ndx + s[4] * pn
    if par is not None and np.isfinite(s[3]):
        out = out + s[3] * par
    return out


def nowcast_feats(P: Panel, i: int, with_parent: bool, pre: bool) -> list[str]:
    f = ["SOX", "NDX"]
    if with_parent and not (pre and P.parent_same_day[i]):
        f.append("PARENT")
    f += [a for a in P.aux_ids if not (pre and a in P.same_day_feats)]
    if P.adrs[i]:
        f.append("ADR")
    return f + ["Y_L1", "NIFTY_L1"]


def nifty_nowcast_feats(P: Panel, pre: bool) -> list[str]:
    return ["SOX", "NDX", *[a for a in P.aux_ids if not (pre and a in P.same_day_feats)], "NIFTY_L1"]


@dataclass
class WF:
    refits: list[int]
    bounds: list[int]
    block_of: np.ndarray
    t0: int
    preds: dict[str, np.ndarray]
    struct_hist: dict[str, np.ndarray]
    sig: dict[str, np.ndarray]
    with_parent: np.ndarray
    fitted: np.ndarray
    nifty_coef: np.ndarray
    nifty_pred: dict[str, np.ndarray]
    nifty_sig: dict[str, np.ndarray]
    lam: dict[str, np.ndarray]
    final: dict[str, dict[int, tuple[list[str], np.ndarray]]]
    final_rows: dict[int, np.ndarray]
    weights: dict[str, Any] = field(default_factory=dict)
    bands: dict[str, dict[float, tuple[np.ndarray, np.ndarray]]] = field(default_factory=dict)
    timing: dict[str, float] = field(default_factory=dict)


def schedule(P: Panel, st: LabSettings) -> tuple[int, list[int], list[int], np.ndarray]:
    nd = P.n_data
    t0 = int(np.searchsorted(ns(P.dates[:nd]), ns(st.oos_start)))
    t0 = max(t0, 1)
    refits = list(range(t0, nd, st.refit_every)) + [nd]
    bounds = refits[1:] + [P.T]
    block_of = np.full(P.T, -1, dtype=int)
    for k, (a, b) in enumerate(zip(refits, bounds)):
        block_of[a:b] = k
    return t0, refits, bounds, block_of


def _finite(*arrs: np.ndarray) -> np.ndarray:
    m = np.isfinite(arrs[0])
    for a in arrs[1:]:
        m &= np.isfinite(a)
    return m


def _ridge_fit(X: np.ndarray, y: np.ndarray, lambdas: tuple[float, ...], val: int) -> tuple[np.ndarray | None, np.ndarray]:
    """Validation scores (SSE / SSE of zero, last `val` rows) for each lambda, fitted on the earlier rows."""
    n = len(y)
    if n - val < max(60, 3 * X.shape[1]) or val < 20:
        return None, np.full(len(lambdas), np.nan)
    Xa, ya = X[: n - val], y[: n - val]
    mu, sd = Xa.mean(0), Xa.std(0)
    sd[sd <= 0] = 1.0
    B = fit.ridge_path((Xa - mu) / sd, ya - ya.mean(), lambdas) / sd[:, None]
    pv = X[n - val:] @ B
    yv = y[n - val:]
    sse0 = float(yv @ yv)
    return B, (np.sum((yv[:, None] - pv) ** 2, axis=0) / sse0) if sse0 > 0 else np.full(len(lambdas), np.nan)


def _ridge_final(X: np.ndarray, y: np.ndarray, lam: float) -> tuple[np.ndarray, float]:
    mu, sd = X.mean(0), X.std(0)
    sd[sd <= 0] = 1.0
    Xs = (X - mu) / sd
    yc = y - y.mean()
    b = fit.ridge_path(Xs, yc, [lam])[:, 0]
    r = yc - Xs @ b
    return b / sd, float(np.std(r, ddof=X.shape[1] + 1))


def run_walkforward(P: Panel, st: LabSettings, log: Callable[[str], None] = print) -> WF:
    T, N, nd = P.T, P.N, P.n_data
    W = st.train_sessions
    t0, refits, bounds, block_of = schedule(P, st)
    K = len(refits)
    F = P.F
    preds = {m: np.full((T, N), np.nan) for m in (*LINEAR, "nowcast", "nowcast_pre")}
    struct_hist = {m: np.full((K, N, 5), np.nan) for m in LINEAR}
    sig = {m: np.full((K, N), np.nan) for m in ("ols_rf", "nowcast", "nowcast_pre")}
    with_parent = np.zeros((K, N), dtype=bool)
    fitted = np.zeros((K, N), dtype=bool)
    nifty_coef = np.full((K, 3), np.nan)
    nifty_pred = {m: np.full(T, np.nan) for m in ("ols", "nowcast", "nowcast_pre")}
    nifty_sig = {m: np.full(K, np.nan) for m in ("ols", "nowcast", "nowcast_pre")}
    lam = {m: np.full(K, np.nan) for m in ("nowcast", "nowcast_pre")}
    final: dict[str, dict[int, tuple[list[str], np.ndarray]]] = {m: {} for m in (*LINEAR, "nowcast", "nowcast_pre")}
    final_rows: dict[int, np.ndarray] = {}
    timing = {"linear": 0.0, "ridge": 0.0}
    H = st.ewma_half_life
    ny, nS, nD = P.nifty["y"], P.nifty["SOX"], P.nifty["NDX"]
    for k, R in enumerate(refits):
        is_final = k == K - 1
        min_obs = st.final_min_obs if is_final else st.min_train_obs
        trn = np.arange(max(0, R - W), R)
        B = np.arange(R, bounds[k])
        tl = time.time()
        # ---- Nifty model (OLS, same window)
        m = _finite(ny[trn], nS[trn], nD[trn])
        if m.sum() >= min_obs:
            r = trn[m]
            Xn = np.column_stack([np.ones(len(r)), nS[r], nD[r]])
            c, _, s_ = fit.ols(Xn, ny[r])
            nifty_coef[k], nifty_sig["ols"][k] = c, s_
            nifty_pred["ols"][B] = c[1] * nS[B] + c[2] * nD[B]
        c_k = nifty_coef[k]
        # ---- per-stock linear zoo
        ols_fit: dict[int, tuple[list[str], np.ndarray, np.ndarray]] = {}
        pred_rows: dict[int, tuple[np.ndarray, np.ndarray]] = {}
        for i in range(N):
            y_all = P.Y[:, i]
            base = _finite(y_all[trn], F["SOX"][trn, i], F["NDX"][trn, i], F["NIFTY"][trn, i], F["SOX_L1"][trn, i], F["NDX_L1"][trn, i])
            wp = False
            if P.parents[i] is not None:
                wp = int((base & _finite(F["PARENT"][trn, i], F["PARENT_L1"][trn, i])).sum()) >= min_obs
            mask = base & _finite(F["PARENT"][trn, i], F["PARENT_L1"][trn, i]) if wp else base
            if mask.sum() < min_obs or not np.all(np.isfinite(c_k)):
                continue
            rows = trn[mask]
            yy = y_all[rows]
            fitted[k, i], with_parent[k, i] = True, wp
            if is_final:
                final_rows[i] = rows
            pm = _finite(F["SOX"][B, i], F["NDX"][B, i], F["SOX_L1"][B, i], F["NDX_L1"][B, i], F["SOXn"][B, i], F["NDXn"][B, i])
            if wp:
                pm &= _finite(F["PARENT"][B, i], F["PARENT_L1"][B, i])
            pB = B[pm]
            pn = c_k[1] * F["SOXn"][pB, i] + c_k[2] * F["NDXn"][pB, i]
            pred_rows[i] = (pB, pn)
            for model in LINEAR:
                if model == "shrink":
                    continue
                cols = cols_for(model, wp)
                X = matrix(F, i, rows, cols)
                if model == "ols":
                    b, se, _ = fit.ols(X, yy)
                    ols_fit[i] = (cols, b, se)
                elif model == "ols_rf":
                    b, _, s_ = fit.ols(X, yy)
                    sig["ols_rf"][k, i] = s_
                elif model == "ewma":
                    b = fit.lstsq(X, yy, 0.5 ** ((R - 1 - rows) / H))
                elif model == "huber":
                    b = fit.huber(X, yy, st.huber_c, st.huber_max_iter)
                else:
                    b = fit.lstsq(X, yy)
                struct_hist[model][k, i] = struct(model, cols, b)
                if is_final:
                    final[model][i] = (cols, b)
                if len(pB):
                    Xp = matrix(F, i, pB, cols, pn if "NIFTY" in cols else None)
                    preds[model][pB, i] = Xp[:, 1:] @ b[1:]
        # ---- empirical-Bayes shrinkage of the OLS coefficients toward the tier mean
        if ols_fit:
            idx = sorted(ols_fit)
            shr = {i: ols_fit[i][1].copy() for i in idx}
            for name in COEF_NAMES:
                have = [i for i in idx if name in ols_fit[i][0]]
                if not have:
                    continue
                pos = {i: 1 + ols_fit[i][0].index(name) for i in have}
                b_ = np.array([ols_fit[i][1][pos[i]] for i in have])
                s_ = np.array([ols_fit[i][2][pos[i]] for i in have])
                bt = fit.eb_shrink(b_, s_, P.tiers[have], st.shrink_tau2_floor, st.shrink_min_group)
                for j, i in enumerate(have):
                    shr[i][pos[i]] = bt[j]
            for i in idx:
                cols = ols_fit[i][0]
                b = shr[i]
                struct_hist["shrink"][k, i] = struct("shrink", cols, b)
                if is_final:
                    final["shrink"][i] = (cols, b)
                pB, pn = pred_rows[i]
                if len(pB):
                    preds["shrink"][pB, i] = matrix(F, i, pB, cols, pn)[:, 1:] @ b[1:]
        timing["linear"] += time.time() - tl
        # ---- nowcast ridge (India-listed targets), penalty chosen on pooled validation scores
        tr = time.time()
        for variant, pre in (("nowcast", False), ("nowcast_pre", True)):
            cand: dict[int, tuple[list[str], np.ndarray, np.ndarray]] = {}
            scores = []
            for i in range(N):
                if P.markets[i] != "IN" or not fitted[k, i]:
                    continue
                fl = nowcast_feats(P, i, bool(with_parent[k, i]), pre)
                X_all = np.column_stack([F[f][trn, i] for f in fl])
                mm = np.isfinite(P.Y[trn, i]) & np.all(np.isfinite(X_all), axis=1)
                if mm.sum() < min_obs:
                    continue
                X, yy = X_all[mm], P.Y[trn[mm], i]
                cand[i] = (fl, X, yy)
                _, sc = _ridge_fit(X, yy, st.ridge_lambdas, st.ridge_val_sessions)
                if np.all(np.isfinite(sc)):
                    scores.append(sc)
            if not cand:
                continue
            li = int(np.argmin(np.sum(scores, axis=0))) if scores else len(st.ridge_lambdas) - 1
            lam[variant][k] = st.ridge_lambdas[li]
            for i, (fl, X, yy) in cand.items():
                b, s_ = _ridge_final(X, yy, st.ridge_lambdas[li])
                sig[variant][k, i] = s_
                if is_final:
                    final[variant][i] = (fl, b)
                XB = np.column_stack([F[f][B, i] for f in fl]) if len(B) else np.zeros((0, len(fl)))
                ok = np.all(np.isfinite(XB), axis=1)
                if ok.any():
                    preds[variant][B[ok], i] = XB[ok] @ b
            # Nifty nowcast (own penalty choice)
            fl = nifty_nowcast_feats(P, pre)
            X_all = np.column_stack([P.nifty[f][trn] for f in fl])
            mm = np.isfinite(ny[trn]) & np.all(np.isfinite(X_all), axis=1)
            if mm.sum() >= min_obs:
                X, yy = X_all[mm], ny[trn[mm]]
                _, sc = _ridge_fit(X, yy, st.ridge_lambdas, st.ridge_val_sessions)
                lj = int(np.nanargmin(sc)) if np.any(np.isfinite(sc)) else len(st.ridge_lambdas) - 1
                b, s_ = _ridge_final(X, yy, st.ridge_lambdas[lj])
                nifty_sig[variant][k] = s_
                XB = np.column_stack([P.nifty[f][B] for f in fl]) if len(B) else np.zeros((0, len(fl)))
                ok = np.all(np.isfinite(XB), axis=1)
                if ok.any():
                    nifty_pred[variant][B[ok]] = XB[ok] @ b
        timing["ridge"] += time.time() - tr
    log(f"[modellab] walk-forward: {K - 1} refits + final fit, {int(fitted.sum())} stock-fits "
        f"(linear {timing['linear']:.1f}s, ridge {timing['ridge']:.1f}s)")
    return WF(refits=refits, bounds=bounds, block_of=block_of, t0=t0, preds=preds, struct_hist=struct_hist, sig=sig,
              with_parent=with_parent, fitted=fitted, nifty_coef=nifty_coef, nifty_pred=nifty_pred, nifty_sig=nifty_sig,
              lam=lam, final=final, final_rows=final_rows, timing=timing)


# ------------------------------------------------------------------------------------------ stacking
def equal_weights(m: int) -> np.ndarray:
    return np.full(m, 1.0 / m)


def stack(P: Panel, wf: WF, st: LabSettings, comps: tuple[str, ...] = LINEAR) -> None:
    """NNLS stacking on the simplex (weights >= 0, remainder on the zero forecast). Refit k only uses
    out-of-sample rows before refit k. Tier weights replace the global ones once the tier has enough rows."""
    T, N = P.T, P.N
    M = len(comps)
    tiers = sorted(set(P.tiers.tolist()))
    G = {"ALL": np.zeros((M, M)), **{t: np.zeros((M, M)) for t in tiers}}
    c = {key: np.zeros(M) for key in G}
    n = {key: 0 for key in G}
    ens = np.full((T, N), np.nan)
    ens_g = np.full((T, N), np.nan)
    hist = []
    Pm = np.stack([wf.preds[m] for m in comps], axis=-1)  # T x N x M
    for k, R in enumerate(wf.refits):
        wg = fit.simplex_weights(G["ALL"], c["ALL"]) if n["ALL"] >= st.stack_min_rows else equal_weights(M)
        wt = {t: (fit.simplex_weights(G[t], c[t]) if n[t] >= st.stack_min_rows else wg) for t in tiers}
        hist.append({"ALL": wg, **wt, "n": dict(n)})
        a, b = R, wf.bounds[k]
        if b > a:
            blk = Pm[a:b]  # rows x N x M
            for i in range(N):
                ens[a:b, i] = blk[:, i, :] @ wt[P.tiers[i]]
                ens_g[a:b, i] = blk[:, i, :] @ wg
            # add this block's realised rows to the stacking statistics (used from refit k+1 on)
            y = P.Y[a:b]
            ok = np.isfinite(y) & np.all(np.isfinite(blk), axis=-1)
            for i in range(N):
                r = ok[:, i]
                if not r.any():
                    continue
                X = blk[r, i, :]
                yy = y[r, i]
                for key in ("ALL", P.tiers[i]):
                    G[key] += X.T @ X
                    c[key] += X.T @ yy
                    n[key] += int(r.sum())
    wf.preds["ensemble"] = ens
    wf.preds["ens_global"] = ens_g
    wf.weights = {"comps": list(comps), "hist": hist, "final": hist[-1]}


# ------------------------------------------------------------------------------------------ bands
def band_offsets(resid: np.ndarray, sig_k: np.ndarray, wf: WF, st: LabSettings, levels: tuple[float, ...] | None = None
                 ) -> dict[float, tuple[np.ndarray, np.ndarray]]:
    """Prediction-band offsets from trailing out-of-sample residuals, standardised by each refit's in-sample
    residual sd (so bands widen when volatility rises): own residuals when a stock has `band_min_obs`, else
    the pool of all stocks. Only residuals realised before the refit are used."""
    levels = levels or st.band_levels
    T, N = resid.shape
    out = {lv: (np.full((T, N), np.nan), np.full((T, N), np.nan)) for lv in levels}
    sig_row = np.full((T, N), np.nan)
    for k, (a, b) in enumerate(zip(wf.refits, wf.bounds)):
        sig_row[a:b] = sig_k[k]
    z = resid / sig_row
    qs = sorted({q for lv in levels for q in ((1 - lv) / 2, (1 + lv) / 2)})
    for k, R in enumerate(wf.refits):
        a, b = R, wf.bounds[k]
        if b <= a:
            continue
        lo = max(0, R - st.band_lookback)
        zz = z[lo:R]
        pool = zz[np.isfinite(zz)]
        qpool = np.quantile(pool, qs) if len(pool) >= st.band_min_obs else None
        for i in range(N):
            s_now = sig_k[k, i]
            if not np.isfinite(s_now):
                continue
            own = zz[:, i]
            own = own[np.isfinite(own)]
            if len(own) >= st.band_min_obs:
                q = np.quantile(own, qs)
            elif qpool is not None:
                q = qpool
            else:
                continue
            qd = dict(zip(qs, q))
            for lv in levels:
                out[lv][0][a:b, i] = qd[(1 - lv) / 2] * s_now
                out[lv][1][a:b, i] = qd[(1 + lv) / 2] * s_now
    return out
