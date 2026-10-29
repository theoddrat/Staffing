"""Multi-session horizons (DESIGN.md §9.3): h-session cumulative India log returns on the cumulative aligned
factors over the same sessions. Fitting uses overlapping windows; testing uses non-overlapping blocks that
start at each refit, so every tested block lies entirely after the data its models were fitted on.

Candidates per stock: `h1` (the 1-session blend applied to the cumulative moves), `ols_h` (3-year window),
`long_h` (longer window) and `shrink_h` (the 3-year fit shrunk toward `h1` by empirical Bayes). They are
blended exactly like the 1-session zoo. The Nifty model at each horizon is blended the same way from its
own `h1` / 3-year / long-window candidates and is what every stock's reduced form uses at that horizon.
"""
from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd

from pipeline.modellab import fit
from pipeline.modellab.metrics import oos_stats
from pipeline.modellab.panel import Panel
from pipeline.modellab.settings import LabSettings
from pipeline.modellab.walkforward import WF, struct_predict

CANDS = ("h1", "ols_h", "long_h", "shrink_h")
NCANDS = ("h1", "ols_h", "long_h")
SESSIONS_PER_YEAR = 252


def cumsum_h(a: np.ndarray, h: int) -> np.ndarray:
    """Trailing h-row sums; NaN unless all h rows are finite."""
    df = pd.DataFrame(a if a.ndim == 2 else a[:, None])
    out = df.rolling(h, min_periods=h).sum().to_numpy()
    return out if a.ndim == 2 else out[:, 0]


def block_ends(R: int, end: int, h: int, n_data: int) -> list[int]:
    """Last rows of the non-overlapping h-blocks that start at R and finish before `end` (exclusive)."""
    out = []
    e = R + h - 1
    while e < end and e < n_data:
        out.append(e)
        e += h
    return out


def _ols_struct(Yh: np.ndarray, Xc: dict[str, np.ndarray], i: int, rows: np.ndarray, wp: bool, min_obs: int
                ) -> tuple[np.ndarray, np.ndarray] | None:
    cols = ["SOX", "NDX", *(["PARENT"] if wp else []), "NIFTY"]
    X = np.column_stack([np.ones(len(rows))] + [Xc[c][rows, i] for c in cols])
    y = Yh[rows, i]
    m = np.isfinite(y) & np.all(np.isfinite(X), axis=1)
    if m.sum() < min_obs:
        return None
    b, se, _ = fit.ols(X[m], y[m])
    d = dict(zip(cols, b[1:]))
    s = dict(zip(cols, se[1:]))
    st_ = np.array([d["SOX"], d["SOX"], d["NDX"], d.get("PARENT", np.nan), d["NIFTY"]])
    se_ = np.array([s["SOX"], s["SOX"], s["NDX"], s.get("PARENT", np.nan), s["NIFTY"]])
    return st_, se_


def run_horizons(P: Panel, wf: WF, st: LabSettings, log: Callable[[str], None] = print) -> dict[int, Any]:
    out: dict[int, Any] = {}
    nd, N = P.n_data, P.N
    W = st.train_sessions
    Wl = st.horizon_long_years * SESSIONS_PER_YEAR
    K = len(wf.refits)
    comps = wf.weights["comps"]
    for h in [x for x in st.horizons if x > 1]:
        Yh = cumsum_h(P.Y, h)
        Xc = {c: cumsum_h(P.F[c], h) for c in ("SOX", "NDX", "PARENT", "NIFTY", "SOXn", "NDXn")}
        nyh, nsh, ndh = cumsum_h(P.nifty["y"], h), cumsum_h(P.nifty["SOX"], h), cumsum_h(P.nifty["NDX"], h)
        npred = {c: np.full(P.T, np.nan) for c in (*NCANDS, "ensemble")}
        spred = {c: np.full((P.T, N), np.nan) for c in (*CANDS, "ensemble")}
        nG, nc_, nn = np.zeros((3, 3)), np.zeros(3), 0
        G, c_, n_ = np.zeros((4, 4)), np.zeros(4), 0
        nW_hist, sW_hist = [], []
        final_coefs: dict[int, dict[str, np.ndarray]] = {}
        c_final = None
        for k, R in enumerate(wf.refits):
            is_final = k == K - 1
            min_obs = (st.final_min_obs if is_final else st.min_train_obs) - h + 1
            ends = block_ends(R, wf.bounds[k], h, nd)
            tr = np.arange(max(h - 1, R - W + h - 1), R)
            trl = np.arange(max(h - 1, R - Wl + h - 1), R)
            # ---- Nifty at horizon h
            c1 = wf.nifty_coef[k]
            ncand: dict[str, np.ndarray] = {}
            if np.all(np.isfinite(c1)):
                ncand["h1"] = c1[1:].copy()
            for name, rows in (("ols_h", tr), ("long_h", trl)):
                m = np.isfinite(nyh[rows]) & np.isfinite(nsh[rows]) & np.isfinite(ndh[rows])
                if m.sum() >= min_obs:
                    r = rows[m]
                    ncand[name] = fit.lstsq(np.column_stack([np.ones(len(r)), nsh[r], ndh[r]]), nyh[r])[1:]
            if len(ncand) < len(NCANDS):
                nW_hist.append(None)
                continue
            nw = fit.simplex_weights(nG, nc_, st.stack_allow_zero) if nn >= st.nifty_horizon_min_blocks.get(h, 10 ** 9) else np.full(3, 1 / 3)
            nW_hist.append(nw)
            ch = sum(nw[j] * ncand[name] for j, name in enumerate(NCANDS))
            if is_final:
                c_final = ch
            if ends:
                e = np.array(ends)
                Pn = np.column_stack([ncand[name][0] * nsh[e] + ncand[name][1] * ndh[e] for name in NCANDS])
                for j, name in enumerate(NCANDS):
                    npred[name][e] = Pn[:, j]
                npred["ensemble"][e] = Pn @ nw
                ok = np.isfinite(nyh[e]) & np.all(np.isfinite(Pn), axis=1)
                nG += Pn[ok].T @ Pn[ok]
                nc_ += Pn[ok].T @ nyh[e][ok]
                nn += int(ok.sum())
            # ---- stocks
            S: dict[str, dict[int, np.ndarray]] = {name: {} for name in CANDS}
            se_ols: dict[int, np.ndarray] = {}
            hw = wf.weights["hist"][k]
            for i in range(N):
                if not wf.fitted[k, i]:
                    continue
                w1 = hw[P.tiers[i]]
                S["h1"][i] = sum(w1[j] * np.nan_to_num(wf.struct_hist[m][k, i]) for j, m in enumerate(comps))
                if not wf.with_parent[k, i]:
                    S["h1"][i][3] = np.nan
                wp = bool(wf.with_parent[k, i])
                r3 = _ols_struct(Yh, Xc, i, tr, wp, min_obs)
                rl = _ols_struct(Yh, Xc, i, trl, wp, min_obs)
                S["ols_h"][i] = r3[0] if r3 else S["h1"][i]
                S["long_h"][i] = rl[0] if rl else S["ols_h"][i]
                if r3:
                    se_ols[i] = r3[1] * np.sqrt(h)  # overlapping sums: effective sample ~ n / h
            # empirical-Bayes shrink of the 3-year horizon fit toward the 1-session blend (pooled across stocks)
            idx = sorted(S["ols_h"])
            for i in idx:
                S["shrink_h"][i] = S["ols_h"][i].copy()
            have = [i for i in idx if i in se_ols]
            for j in range(5):
                hv = [i for i in have if np.isfinite(S["ols_h"][i][j]) and np.isfinite(S["h1"][i][j])]
                if len(hv) < st.shrink_min_group:
                    continue
                dlt = np.array([S["ols_h"][i][j] - S["h1"][i][j] for i in hv])
                s2 = np.array([se_ols[i][j] ** 2 for i in hv])
                tau2 = max(float(np.mean(dlt ** 2)) - float(np.mean(s2)), st.shrink_tau2_floor * float(np.mean(s2)))
                for q, i in enumerate(hv):
                    w = tau2 / (tau2 + s2[q])
                    S["shrink_h"][i][j] = S["h1"][i][j] + w * dlt[q]
            sw = fit.simplex_weights(G, c_, st.stack_allow_zero) if n_ >= st.horizon_stack_min_blocks.get(h, 10 ** 9) else np.full(4, 0.25)
            sW_hist.append(sw)
            if is_final:
                for i in idx:
                    final_coefs[i] = {name: S[name][i] for name in CANDS}
            if not ends:
                continue
            e = np.array(ends)
            pn = ch[0] * Xc["SOXn"][e] + ch[1] * Xc["NDXn"][e]  # (blocks x N)
            for i in idx:
                cols = []
                for name in CANDS:
                    s = S[name][i]
                    par = Xc["PARENT"][e, i] if np.isfinite(s[3]) else None
                    p = struct_predict(s, Xc["SOX"][e, i], Xc["NDX"][e, i], par, pn[:, i])
                    spred[name][e, i] = p
                    cols.append(p)
                Pm = np.column_stack(cols)
                spred["ensemble"][e, i] = Pm @ sw
                ok = np.isfinite(Yh[e, i]) & np.all(np.isfinite(Pm), axis=1)
                if ok.any():
                    G += Pm[ok].T @ Pm[ok]
                    c_ += Pm[ok].T @ Yh[e[ok], i]
                    n_ += int(ok.sum())
        # ---- evaluation on common non-overlapping blocks
        is_end = np.zeros(P.T, dtype=bool)
        for k, R in enumerate(wf.refits):
            is_end[block_ends(R, wf.bounds[k], h, nd)] = True
        is_end[: wf.t0] = False
        cm = is_end[:, None] & np.isfinite(Yh)
        for name in (*CANDS, "ensemble"):
            cm &= np.isfinite(spred[name])
        check = []
        for name in (*CANDS, "ensemble"):
            s = oos_stats(Yh[cm], spred[name][cm], st.hit_threshold)
            if s:
                check.append({"h": h, "model": name, "r2": s["r2"], "n": s["n"]})
        ncm = is_end & np.isfinite(nyh)
        for name in (*NCANDS, "ensemble"):
            ncm &= np.isfinite(npred[name])
        nstats = {name: oos_stats(nyh[ncm], npred[name][ncm], st.hit_threshold) for name in (*NCANDS, "ensemble")}
        stocks: dict[int, dict[str, Any]] = {}
        sw_final = sW_hist[-1] if sW_hist else np.full(4, 0.25)
        for i, fc in final_coefs.items():
            ens = sum(sw_final[j] * np.nan_to_num(fc[name]) for j, name in enumerate(CANDS))
            wp = np.isfinite(fc["ols_h"][3]) or np.isfinite(fc["h1"][3])
            rows = wf.final_rows.get(i)
            if rows is None:
                continue
            r = rows[rows >= h - 1]
            m_ndx = fit.slope(Xc["NDX"][r, i], Xc["SOX"][r, i]) or 0.0
            m_p = (fit.slope(Xc["PARENT"][r, i], Xc["SOX"][r, i]) or 0.0) if wp else 0.0
            cf = c_final if c_final is not None else np.zeros(2)
            bt = ens[0] + ens[2] * m_ndx + (ens[3] * m_p if wp else 0.0) + ens[4] * (cf[0] + cf[1] * m_ndx)
            s = oos_stats(Yh[cm[:, i], i], spred["ensemble"][cm[:, i], i], st.hit_threshold)
            stocks[i] = {"h": h, "SOX": float(ens[0]), "NDX": float(ens[2]), "PARENT": float(ens[3]) if wp else None,
                         "NIFTY": float(ens[4]), "beta_total": float(bt) if np.isfinite(bt) else None,
                         "r2_oos": s["r2"] if s else None, "n_oos": int(s["n"]) if s else 0}
        ns_ = nstats["ensemble"]
        cf = c_final if c_final is not None else np.full(2, np.nan)
        out[h] = {"stocks": stocks, "check": check, "_pred": spred, "_Yh": Yh, "_cm": cm, "_w": sW_hist,
                  "nifty": {"h": h, "SOX": float(cf[0]), "NDX": float(cf[1]), "r2": ns_["r2"] if ns_ else 0.0, "n": ns_["n"] if ns_ else 0},
                  "diag": {"weights": dict(zip(CANDS, [round(float(x), 4) for x in sw_final])),
                           "nifty_weights": dict(zip(NCANDS, [round(float(x), 4) for x in (nW_hist[-1] if nW_hist and nW_hist[-1] is not None else [np.nan] * 3)])),
                           "nifty_r2": {k_: (round(v["r2"], 4) if v else None) for k_, v in nstats.items()},
                           "check": {c["model"]: round(c["r2"], 4) for c in check}, "n_blocks": int(cm.sum())}}
        log(f"[modellab] horizon h={h}: pooled OOS R2 " + ", ".join(f"{c['model']} {c['r2']:.3f}" for c in check)
            + f" (n={check[0]['n'] if check else 0}); Nifty {out[h]['nifty']['r2']:.3f}")
    out_diag = {h: v.pop("diag") for h, v in out.items()}
    res: dict[Any, Any] = dict(out)
    res["_diag"] = out_diag
    res["_method"] = (f"Horizons of {', '.join(str(h) for h in st.horizons if h > 1)} sessions: cumulative returns on the cumulative "
                      "factor moves over the same sessions (overlapping windows to fit, non-overlapping blocks to test). Candidates: the "
                      f"1-session blend applied to the cumulative moves, a {st.train_years}-year fit, a {st.horizon_long_years}-year fit, and the "
                      f"{st.train_years}-year fit shrunk toward the 1-session blend; blended with non-negative weights from earlier "
                      "out-of-sample blocks (equal weights until enough blocks exist). The Nifty model at each horizon is blended the same way. "
                      "The engine maps 1D to h=1, 1M to h=21 and 12M to h=21 applied to the 12-month factor move (an assumption).")
    return res
