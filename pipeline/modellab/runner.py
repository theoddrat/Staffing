"""Entry point: assemble the panel, run the walk-forward zoo, stack, calibrate, and export (with caching)."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from pipeline.export import sanitize
from pipeline.modellab import export as ex
from pipeline.modellab.metrics import coverage, oos_stats
from pipeline.modellab.panel import Panel, build_panel
from pipeline.modellab.settings import LabSettings, as_dict, from_config
from pipeline.modellab.specs import MODEL_SPECS
from pipeline.modellab.walkforward import band_offsets, nowcast_blend, run_walkforward, stack

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / ".cache" / "modellab"
CODE_DIR = Path(__file__).resolve().parent


def fingerprint(P: Panel, st: LabSettings, cfg: dict[str, Any]) -> str:
    h = hashlib.sha256()
    h.update(json.dumps(as_dict(st), sort_keys=True, default=str).encode())
    h.update(json.dumps(cfg.get("factors_aux", []), sort_keys=True, default=str).encode())
    h.update(json.dumps([[t["ticker"], t["tier"], t.get("parent"), t.get("adr"), t.get("display")] for t in cfg["india"]]).encode())
    h.update(P.dates.asi8.tobytes())
    h.update(np.nan_to_num(P.Y, nan=9.99).tobytes())
    for k in sorted(P.F):
        h.update(k.encode())
        h.update(np.nan_to_num(P.F[k], nan=9.99).tobytes())
    for k in sorted(P.nifty):
        h.update(k.encode())
        h.update(np.nan_to_num(P.nifty[k], nan=9.99).tobytes())
    h.update(P.us_dates.asi8.tobytes())
    h.update(json.dumps([P.future, P.future_same_day_ready]).encode())
    for f in sorted(CODE_DIR.glob("*.py")):
        h.update(f.read_bytes())
    return h.hexdigest()


def method_text(st: LabSettings) -> str:
    return (
        f"Walk-forward out-of-sample test. Every {st.refit_every} NSE sessions each model is re-fitted on the previous "
        f"{st.train_sessions} sessions (about {st.train_years} years; a stock needs at least {st.min_train_obs} usable sessions) "
        f"and then predicts the next {st.refit_every} sessions, which it has never seen. Scenario mode uses only the US chip "
        "(SOX) and US tech (Nasdaq-100) moves that reach India that session, the parent's move and the Nifty move implied by a "
        "Nifty model fitted on the same window; intercepts are left out, exactly as the app applies the coefficients. "
        "The blend's weights come from non-negative least squares on out-of-sample predictions made before each refit "
        + ("(weights are at least zero and any remainder goes to the no-change forecast)" if st.stack_allow_zero else
           "(weights are at least zero and sum to one, so crash responses are never shrunk toward no change)")
        + f", per tier once a tier has {st.stack_min_rows} such rows (equal weights before that). Prediction bands use earlier out-of-sample errors, scaled by each refit's volatility. Shock days: the US chip "
        f"move is in the worst {round(100 * st.shock_quantile)}% of the training window. R-squared is measured against the "
        "no-change forecast (1 - SSE/SSE of zero), so a negative value means worse than predicting nothing. Nowcast mode adds "
        "every signal known before the NSE close (US-listed India funds and ADRs, US software, Taiwan and Korea, US yields, the "
        "dollar, the rupee, the previous session) in a ridge regression fitted on the previous "
        f"{st.nowcast_train_sessions} sessions, its penalty chosen by {st.ridge_cv_folds}-fold blocked cross-validation inside "
        "each training window."
    )


def run(cfg: dict[str, Any], ctx: Any, est: Any, nm: dict[str, Any],
        log: Callable[[str], None] = print, use_cache: bool = True) -> tuple[dict[str, Any], dict[str, Any]]:
    t_start = time.time()
    st = from_config(cfg)
    P = build_panel(cfg, ctx, est, nm, log)
    log(f"[modellab] panel {P.n_data} sessions x {P.N} targets ({P.dates[0].date()}..{P.dates[P.n_data - 1].date()}"
        f"{', +1 future session ' + str(P.dates[-1].date()) if P.future else ''}); aux: {', '.join(P.aux_ids)}")
    fp = fingerprint(P, st, cfg)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"{fp[:24]}.json"
    if use_cache and cache.exists():
        blob = json.loads(cache.read_text())
        log(f"[modellab] cache hit {cache.name} ({time.time() - t_start:.1f}s)")
        return blob["sections"], blob["diag"]
    sections, diag = compute(cfg, ctx, P, st, log)
    diag["runtime_s"] = round(time.time() - t_start, 1)
    clean = sanitize({"sections": sections, "diag": diag})
    cache.write_text(json.dumps(clean, allow_nan=False, separators=(",", ":")))
    log(f"[modellab] done in {diag['runtime_s']}s (cached as {cache.name})")
    return clean["sections"], clean["diag"]


def compute(cfg: dict[str, Any], ctx: Any, P: Panel, st: LabSettings, log: Callable[[str], None]) -> tuple[dict[str, Any], dict[str, Any]]:
    tt = {}
    t = time.time()
    wf = run_walkforward(P, st, log)
    tt["walkforward"] = time.time() - t
    t = time.time()
    stack(P, wf, st)
    nowcast_blend(P, wf, st)
    wf.bands["ensemble"] = band_offsets(P.Y - wf.preds["ensemble"], wf.sig["ols_rf"], wf, st)
    tt["stack_bands"] = time.time() - t
    if st.gbm_enabled:
        try:
            from pipeline.modellab.gbm import run_gbm
        except ImportError:
            run_gbm = None
        if run_gbm is not None:
            t = time.time()
            run_gbm(P, wf, st, log)
            tt["gbm"] = time.time() - t
    horizons = None
    try:
        from pipeline.modellab.horizons import run_horizons
    except ImportError:
        run_horizons = None
    if run_horizons is not None:
        t = time.time()
        horizons = run_horizons(P, wf, st, log)
        tt["horizons"] = time.time() - t
    nd = P.n_data
    ms, mn = ex.masks(P, wf)
    shock = ex.shock_days(P, wf, st)
    evs = ex.event_rows(P, wf, st, log)
    b = wf.bands["ensemble"]
    summary = ex.summary_rows(P, wf, st, ms, mn, shock, [e["t"] for e in evs])
    calib = []
    for lv in st.band_levels:
        cov, n = coverage(P.Y[ms], wf.preds["ensemble"][ms], b[lv][0][ms], b[lv][1][ms])
        calib.append({"nominal": lv, "coverage": cov if cov is not None else 0.0, "n": n})
    events = ex.build_events(P, wf, st, evs, b[0.9])
    models = ex.models_section(P, wf, st, ms, mn, shock, b, horizons)
    fw = wf.weights["final"]
    comps = wf.weights["comps"]

    def wdict(w: np.ndarray) -> dict[str, float]:
        d = {m: float(w[j]) for j, m in enumerate(comps)}
        d["zero"] = float(max(0.0, 1.0 - w.sum()))
        return d

    by_tier = {tr: wdict(fw[tr]) for tr in sorted(set(P.tiers.tolist())) if fw["n"].get(tr, 0) >= st.stack_min_rows}
    nifty_ols = oos_stats(P.nifty["y"][wf.t0:nd], wf.nifty_pred["ols"][wf.t0:nd], st.hit_threshold)
    c = wf.nifty_coef[-1]
    nifty_h = [{"h": 1, "SOX": float(c[1]), "NDX": float(c[2]), "r2": nifty_ols["r2"], "n": nifty_ols["n"]}]
    hcheck = [{"h": 1, "model": r["model"], "r2": r["r2"], "n": r["n"]} for r in summary
              if r["mode"] == "scenario" and r["subset"] == "all"]
    if horizons:
        for h in sorted(k for k in horizons if isinstance(k, int)):
            nifty_h.append(horizons[h]["nifty"])
            hcheck += horizons[h]["check"]
    used = set(ex.scenario_models(wf)) | set(ex.nowcast_models(wf))
    backtest = {
        "method": method_text(st) + (" " + horizons["_method"] if horizons and "_method" in horizons else ""),
        "start": P.dates[wf.t0].strftime("%Y-%m-%d"), "end": P.dates[nd - 1].strftime("%Y-%m-%d"),
        "refit_every": st.refit_every, "train_years": st.train_years,
        "dates": [d.strftime("%Y-%m-%d") for d in P.dates[wf.t0:nd]],
        "models": [s for s in MODEL_SPECS if s["id"] in used],
        "ensemble": {"method": "Non-negative least squares on out-of-sample predictions made before each refit; weights sum to one "
                               + ("including the no-change forecast ('zero')" if st.stack_allow_zero else
                                  "(a convex blend; the no-change forecast 'zero' is listed with weight 0)")
                               + f"; a tier uses its own weights once it has {st.stack_min_rows} out-of-sample rows, otherwise the all-stock weights.",
                     "weights": wdict(fw["ALL"]), "weights_by_tier": by_tier},
        "summary": summary, "calibration": calib, "events": events, "horizon_check": hcheck, "nifty_horizons": nifty_h,
        "nifty_oos_resid": [ex._num(v) for v in (P.nifty["y"] - wf.nifty_pred["ols"])[wf.t0:nd]],
    }
    sections = {"factors_aux": ex.factors_aux_section(cfg, ctx, P, st), "models": models, "backtest": backtest,
                "nowcast": ex.nowcast_section(P, wf, st)}
    diag = {"timing": {k: round(v, 1) for k, v in tt.items()}, "aux": P.info.get("aux", []),
            "same_day_markets": P.info.get("same_day_markets", []),
            "future": P.future, "n_refits": len(wf.refits) - 1,
            "nowcast_blend": {v: wf.weights[f"{v}_blend"]["final"] for v in ("nowcast", "nowcast_pre")}, "lambda": {k: [ex._num(x) for x in v] for k, v in wf.lam.items()},
            "weights_hist": [{"refit": P.dates[min(R, P.T - 1)].strftime("%Y-%m-%d"), "ALL": [round(float(x), 4) for x in h["ALL"]],
                              "n": h["n"]["ALL"]} for R, h in zip(wf.refits, wf.weights["hist"])][:: 6]}
    if horizons and "_diag" in horizons:
        diag["horizons"] = horizons["_diag"]
    return sections, diag
