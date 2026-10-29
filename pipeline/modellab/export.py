"""Turn walk-forward results into the optional V2 bundle sections (src/types/data.ts §V2):
`factors_aux`, `models`, `backtest`, `nowcast`."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.align import align_series
from pipeline.modellab import fit
from pipeline.modellab.metrics import coverage, event_metrics, oos_stats, xs_corr
from pipeline.modellab.panel import Panel, ns
from pipeline.modellab.settings import LabSettings
from pipeline.modellab.specs import SPEC_BY_ID
from pipeline.modellab.walkforward import LINEAR, WF, band_offsets

CONTRACT_MARKETS = {"US", "IN", "JP", "DE", "CH", "FR", "TW", "KR", "NL", "FX"}


def _num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None


def scenario_models(wf: WF) -> list[str]:
    return ["zero", *LINEAR, *(["gbm"] if "gbm" in wf.preds else []), "ensemble"]


def nowcast_models(wf: WF) -> list[str]:
    return ["zero", "ensemble", "nowcast", "nowcast_pre", *(["gbm_now"] if "gbm_now" in wf.preds else [])]


def pred(wf: WF, m: str, like: np.ndarray) -> np.ndarray:
    return np.zeros_like(like) if m == "zero" else wf.preds[m]


def shock_days(P: Panel, wf: WF, st: LabSettings) -> np.ndarray:
    """x_SOX at or below its q-quantile over each refit's own training window (no look-ahead)."""
    sox = P.nifty["SOX"]
    out = np.zeros(P.T, dtype=bool)
    for k, R in enumerate(wf.refits):
        a, b = R, wf.bounds[k]
        tr = sox[max(0, R - st.train_sessions):R]
        tr = tr[np.isfinite(tr)]
        if b > a and len(tr):
            thr = float(np.quantile(tr, st.shock_quantile))
            out[a:b] = np.isfinite(sox[a:b]) & (sox[a:b] <= thr)
    return out


def masks(P: Panel, wf: WF) -> tuple[np.ndarray, np.ndarray]:
    T, N, nd = P.T, P.N, P.n_data
    oos = np.zeros((T, 1), dtype=bool)
    oos[wf.t0:nd] = True
    base = oos & np.isfinite(P.Y)
    ms = base.copy()
    for m in scenario_models(wf):
        if m != "zero":
            ms &= np.isfinite(wf.preds[m])
    mn = base & np.array([mk == "IN" for mk in P.markets])[None, :]
    for m in nowcast_models(wf):
        if m != "zero":
            mn &= np.isfinite(wf.preds[m])
    return ms, mn


def event_rows(P: Panel, wf: WF, st: LabSettings, log) -> list[dict[str, Any]]:
    nd = P.n_data
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for e in st.events:
        t = P.india_row_of_us(e["us_date"])
        if t is None or t < wf.t0 or t >= nd:
            log(f"[modellab] event {e['id']} ({e['us_date']}) outside the out-of-sample window — skipped")
            continue
        out.append({"id": e["id"], "label": e["label"], "us_date": e["us_date"], "t": t, "kind": "named"})
        seen.add(t)
    sox = P.nifty["SOX"]
    first = int(np.searchsorted(ns(P.dates[:nd]), ns(st.worst_sox_since)))
    cand = [t for t in range(max(first, wf.t0), nd) if np.isfinite(sox[t])]
    cand.sort(key=lambda t: sox[t])
    for t in cand[: st.worst_sox_n]:
        if t in seen:
            continue
        ud = P.last_us_date_of_row(t)
        lbl = f"US chips {100 * (np.exp(sox[t]) - 1):+.1f}%" + (f" ({ud.strftime('%d %b %Y')})" if ud is not None else "")
        out.append({"id": f"worst_sox_{P.dates[t].strftime('%Y%m%d')}", "label": lbl,
                    "us_date": ud.strftime("%Y-%m-%d") if ud is not None else None, "t": t, "kind": "worst_sox"})
        seen.add(t)
    out.sort(key=lambda e: e["t"])
    return out


def build_events(P: Panel, wf: WF, st: LabSettings, evs: list[dict[str, Any]], b90: tuple[np.ndarray, np.ndarray]) -> list[dict[str, Any]]:
    models = scenario_models(wf)
    res = []
    for e in evs:
        t = e["t"]
        A = P.Y[t]
        ens = wf.preds["ensemble"][t]
        ok = np.isfinite(A) & np.isfinite(ens)
        rows = []
        for i in np.nonzero(ok)[0]:
            lo, hi = b90[0][t, i], b90[1][t, i]
            rows.append({
                "ticker": P.tickers[i], "display": P.display[i], "tier": str(P.tiers[i]), "actual": float(A[i]),
                "pred": {m: (0.0 if m == "zero" else _num(wf.preds[m][t, i])) for m in models},
                "lo90": _num(ens[i] + lo) if np.isfinite(lo) else None, "hi90": _num(ens[i] + hi) if np.isfinite(hi) else None,
            })
        if not rows:
            continue
        metrics = {}
        for m in models:
            p = np.zeros(P.N) if m == "zero" else wf.preds[m][t]
            metrics[m] = event_metrics(A[ok], p[ok], st.hit_threshold, st.event_min_stocks)
        res.append({"id": e["id"], "label": e["label"], "us_date": e["us_date"], "india_date": P.dates[t].strftime("%Y-%m-%d"),
                    "kind": e["kind"], "x_sox": float(P.nifty["SOX"][t]), "x_ndx": float(P.nifty["NDX"][t]),
                    "rows": rows, "metrics": metrics})
    return res


def summary_rows(P: Panel, wf: WF, st: LabSettings, ms: np.ndarray, mn: np.ndarray, shock: np.ndarray,
                 ev_t: list[int]) -> list[dict[str, Any]]:
    A = P.Y
    evm = np.zeros((P.T, 1), dtype=bool)
    evm[ev_t] = True
    out = []
    for mode, base, models in (("scenario", ms, scenario_models(wf)), ("nowcast", mn, nowcast_models(wf))):
        for subset, sm in (("all", base), ("shock", base & shock[:, None]), ("events", base & evm)):
            if not sm.any():
                continue
            days = np.nonzero(sm.any(axis=1))[0]
            Am = np.where(sm, A, np.nan)
            for m in models:
                p = pred(wf, m, A)
                s = oos_stats(A[sm], p[sm], st.hit_threshold)
                if s is None:
                    continue
                cx = None if m == "zero" else xs_corr(Am, np.where(sm, p, np.nan), days, st.xs_min_stocks)
                out.append({"mode": mode, "subset": subset, "model": m, **s, "corr_xs": cx})
    return out


def scenario_map(ctx: Any, cfg: dict[str, Any], series: pd.Series, mk: str, years: int) -> dict[str, Any] | None:
    """Co-movement of an auxiliary signal with the US AI factors (same-day for US-calendar series, else Dimson
    with one lead), on its own calendar over the last `years` years."""
    markets = cfg["markets"]
    s = series.dropna()
    if s.empty:
        return None
    s = s[s.index >= s.index[-1] - pd.DateOffset(years=years)]
    own = pd.DatetimeIndex(s.index)
    X = {}
    for name, src in (("SOX", "^SOX"), ("NDX", "^NDX")):
        x, _ = align_series(own, markets[mk], ctx.logret(src), markets[ctx.market_of(src)])
        X[name + "0"] = x
        if mk != "US":
            X[name + "1"] = x.shift(-1)
    df = pd.DataFrame({"y": s, **X}).dropna()
    if len(df) < 120:
        return None
    Xm = np.column_stack([np.ones(len(df)), df.drop(columns="y").to_numpy()])
    b = fit.lstsq(Xm, df["y"].to_numpy())
    cols = list(df.drop(columns="y").columns)
    d = dict(zip(cols, b[1:]))
    r = df["y"].to_numpy() - Xm @ b
    yc = df["y"].to_numpy() - df["y"].mean()
    return {"SOX": float(d["SOX0"] + d.get("SOX1", 0.0)), "NDX": float(d["NDX0"] + d.get("NDX1", 0.0)),
            "r2": float(1 - (r @ r) / (yc @ yc)), "n": int(len(df))}


def factors_aux_section(cfg: dict[str, Any], ctx: Any, P: Panel, st: LabSettings) -> list[dict[str, Any]]:
    ok = {a["id"] for a in P.info.get("aux", []) if a["ok"]}
    out = []
    for a in cfg.get("factors_aux", []) or []:
        if a["id"] not in ok:
            continue
        if a.get("kind", "return") == "change":
            s = ctx.prices(a["ticker"])["Close"].astype(float).diff().dropna()
        else:
            s = ctx.logret(a["ticker"])
        out.append({"id": a["id"], "ticker": a["ticker"], "name": a["name"],
                    "market": a["market"] if a["market"] in CONTRACT_MARKETS else "OTHER", "role": a["role"],
                    "scenario_map": scenario_map(ctx, cfg, s, a["market"], st.train_years)})
    for i, adr in enumerate(P.adrs):
        if not adr:
            continue
        out.append({"id": f"ADR_{adr}", "ticker": adr, "name": f"{P.display[i]} US-listed shares (ADR)", "market": "US",
                    "role": f"{P.display[i]}'s own shares traded in New York while India is closed; their overnight move is the most direct clue to how {P.display[i]} will open in Mumbai.",
                    "scenario_map": scenario_map(ctx, cfg, ctx.logret(adr), "US", st.train_years)})
    return out


def _h1_entry(P: Panel, wf: WF, i: int, w: np.ndarray, oos_ens: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]] | None:
    comps = wf.weights["comps"]
    if any(i not in wf.final[m] for m in comps):
        return None
    from pipeline.modellab.walkforward import struct

    S = {m: struct(m, *wf.final[m][i]) for m in comps}
    wp = any("PARENT" in wf.final[m][i][0] for m in comps)
    components = {}
    for j, m in enumerate(comps):
        s = S[m]
        components[m] = {"SOX": float(s[0]), "NDX": float(s[2]), "PARENT": _num(s[3]) if wp else None,
                         "NIFTY": float(s[4]), "weight": float(w[j])}
    components["zero"] = {"SOX": 0.0, "NDX": 0.0, "PARENT": 0.0 if wp else None, "NIFTY": 0.0,
                          "weight": float(max(0.0, 1.0 - float(np.sum(w))))}
    ens = {"SOX": float(sum(w[j] * S[m][0] for j, m in enumerate(comps))),
           "NDX": float(sum(w[j] * S[m][2] for j, m in enumerate(comps))),
           "PARENT": float(sum(w[j] * S[m][3] for j, m in enumerate(comps))) if wp else None,
           "NIFTY": float(sum(w[j] * S[m][4] for j, m in enumerate(comps)))}
    rows = wf.final_rows[i]
    sox, ndx = P.F["SOX"][rows, i], P.F["NDX"][rows, i]
    m_ndx = fit.slope(ndx, sox) or 0.0
    m_p = (fit.slope(P.F["PARENT"][rows, i], sox) or 0.0) if wp else 0.0
    c = wf.nifty_coef[-1]
    bt = ens["SOX"] + ens["NDX"] * m_ndx + (ens["PARENT"] or 0.0) * m_p + ens["NIFTY"] * (c[1] + c[2] * m_ndx)
    h1 = {"h": 1, **ens, "beta_total": _num(bt), "r2_oos": oos_ens["r2"] if oos_ens else None,
          "n_oos": int(oos_ens["n"]) if oos_ens else 0}
    return h1, components


def models_section(P: Panel, wf: WF, st: LabSettings, ms: np.ndarray, mn: np.ndarray, shock: np.ndarray,
                   bands: dict[float, tuple[np.ndarray, np.ndarray]], horizons: dict[int, Any] | None = None) -> list[dict[str, Any]]:
    A = P.Y
    nd = P.n_data
    fw = wf.weights["final"]
    out = []
    lo90, hi90 = bands[0.9]
    for i in range(P.N):
        w = fw[P.tiers[i]]
        oos = {}
        oos_sh = {}
        for m in scenario_models(wf):
            p = pred(wf, m, A)[:, i]
            s = oos_stats(A[ms[:, i], i], p[ms[:, i]], st.hit_threshold)
            if s:
                oos[m] = s
            sm = ms[:, i] & shock
            s = oos_stats(A[sm, i], p[sm], st.hit_threshold)
            if s:
                oos_sh[m] = s
        oos_nc = None
        if P.markets[i] == "IN" and mn[:, i].any():
            oos_nc = {}
            for m in nowcast_models(wf):
                p = pred(wf, m, A)[:, i]
                s = oos_stats(A[mn[:, i], i], p[mn[:, i]], st.hit_threshold)
                if s:
                    oos_nc[m] = s
        h = _h1_entry(P, wf, i, w, oos.get("ensemble"))
        if h is None:
            continue
        h1, components = h
        hz = [h1]
        if horizons:
            for hh in sorted(k for k in horizons if isinstance(k, int)):
                e = horizons[hh]["stocks"].get(i)
                if e is not None:
                    hz.append(e)
        resid = (A - wf.preds["ensemble"])[wf.t0:nd, i]
        cov, _ = coverage(A[ms[:, i], i], wf.preds["ensemble"][ms[:, i], i], lo90[ms[:, i], i], hi90[ms[:, i], i])
        out.append({"ticker": P.tickers[i], "horizons": hz, "components": components, "oos": oos, "oos_shock": oos_sh,
                    "oos_nowcast": oos_nc, "oos_resid": [_num(v) for v in resid], "coverage90": cov})
    return out


def nowcast_section(P: Panel, wf: WF, st: LabSettings) -> dict[str, Any] | None:
    nd, T = P.n_data, P.T
    if P.future:  # the first NSE session missing from the data, fed by the US session(s) that closed before it
        t = T - 1
        us_last = P.last_us_date_of_row(t)
    else:  # every NSE session is in: the latest US close feeds the newest one (its actual is known)
        us_last = P.us_dates[-1]
        t = P.india_row_of_us(us_last)
    if t is None or us_last is None:
        return None
    variant = "nowcast" if (t < nd or P.future_same_day_ready) else "nowcast_pre"
    pr = wf.preds[variant]
    b = band_offsets(P.Y - pr, wf.sig[variant], wf, st, (0.9,))[0.9]
    rows = []
    for i in range(P.N):
        if P.markets[i] != "IN" or not np.isfinite(pr[t, i]):
            continue
        lo, hi = b[0][t, i], b[1][t, i]
        r = {"ticker": P.tickers[i], "display": P.display[i], "pred": float(pr[t, i]),
             "lo90": _num(pr[t, i] + lo) if np.isfinite(lo) else None, "hi90": _num(pr[t, i] + hi) if np.isfinite(hi) else None}
        if t < nd:
            r["actual"] = _num(P.Y[t, i])
        rows.append(r)
    npred = wf.nifty_pred[variant]
    nifty = None
    if np.isfinite(npred[t]):
        nb = band_offsets((P.nifty["y"] - npred)[:, None], wf.nifty_sig[variant][:, None], wf, st, (0.9,))[0.9]
        lo, hi = nb[0][t, 0], nb[1][t, 0]
        nifty = {"pred": float(npred[t]), "lo90": _num(npred[t] + lo) if np.isfinite(lo) else None,
                 "hi90": _num(npred[t] + hi) if np.isfinite(hi) else None}
        if t < nd:
            nifty["actual"] = _num(P.nifty["y"][t])
    asia = " and that day's Taiwan, Korea and Japan closes" if variant == "nowcast" else " (Asian closes for that session not available, so only before-the-open clues)"
    note = (f"Model check, not a trading signal: predicted out of sample from the {us_last.strftime('%d %b %Y')} US close{asia} "
            f"with the '{SPEC_BY_ID[variant]['label']}' model. Most of this move happens at the NSE open, so it could not have "
            f"been traded at the previous close. Log returns; US-listed targets are excluded.")
    if t >= nd:
        later = P.us_dates[P.us_dates > us_last]
        note += (" No NSE close for this session was available from Yahoo Finance at build time (assumed to be the next weekday), "
                 "so there is no actual yet.")
        if len(later):
            note += f" The later US session ({later[-1].strftime('%d %b %Y')}) feeds the session after it."
    return {"us_date": us_last.strftime("%Y-%m-%d"), "for_india_date": P.dates[t].strftime("%Y-%m-%d"), "note": note,
            "rows": rows, "nifty": nifty}
