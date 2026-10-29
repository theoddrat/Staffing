"""Model lab (pipeline/modellab): no network, synthetic panels only."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from pipeline.export import sanitize
from pipeline.modellab import fit
from pipeline.modellab.horizons import block_ends, cumsum_h
from pipeline.modellab.panel import BASE_FEATS, Panel
from pipeline.modellab.runner import compute
from pipeline.modellab.settings import LabSettings
from pipeline.modellab.walkforward import LINEAR, WF, band_offsets, run_walkforward, schedule, stack
from pipeline.validate import BACKTEST, FACTOR_AUX, NOWCAST, STOCK_MODELS, L, check


def settings(**kw) -> LabSettings:
    base = dict(
        oos_start="2013-03-01", train_sessions=250, min_train_obs=150, refit_every=21, ewma_half_life=60.0,
        huber_c=1.345, huber_max_iter=50, shrink_tau2_floor=0.05, shrink_min_group=3, gbm_enabled=False,
        gbm_refit_every=63, gbm={"max_iter": 20, "learning_rate": 0.1, "max_leaf_nodes": 7, "min_samples_leaf": 50,
                                 "l2_regularization": 1.0},
        gbm_feature_window=60, gbm_feature_min_obs=30, ridge_lambdas=(0.01, 0.1, 1.0), ridge_cv_folds=3,
        nowcast_train_sessions=300, stack_min_rows=400, stack_allow_zero=False, band_levels=(0.5, 0.8, 0.9),
        band_min_obs=60, band_lookback=250, hit_threshold=0.005, shock_quantile=0.05, xs_min_stocks=3,
        event_min_stocks=3, final_min_obs=100, horizons=(1, 5, 21), horizon_long_years=2,
        horizon_stack_min_blocks={5: 100, 21: 30}, nifty_horizon_min_blocks={5: 20, 21: 6},
        worst_sox_since="2013-01-01", worst_sox_n=3, events=(),
    )
    base.update(kw)
    return LabSettings(**base)


def synthetic_panel(T: int = 900, N: int = 6, seed: int = 0, beta: np.ndarray | None = None,
                    beta_after: tuple[int, np.ndarray] | None = None) -> Panel:
    """y_i = b_i * SOX + 0.3 NDX + 0.5 NIFTY + noise; NIFTY = 0.2 SOX + 0.1 NDX + noise. Optional regime switch."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2012-01-02", periods=T)
    sox = rng.normal(0, 0.02, T)
    ndx = 0.5 * sox + rng.normal(0, 0.012, T)
    nifty = 0.2 * sox + 0.1 * ndx + rng.normal(0, 0.008, T)
    b = beta if beta is not None else np.linspace(0.1, 0.6, N)
    Y = np.empty((T, N))
    for i in range(N):
        bi = np.full(T, b[i])
        if beta_after is not None:
            bi[beta_after[0]:] = beta_after[1][i]
        Y[:, i] = bi * sox + 0.3 * ndx + 0.5 * nifty + rng.normal(0, 0.015, T)
    F = {k: np.full((T, N), np.nan) for k in BASE_FEATS}
    lag = lambda a: np.r_[np.nan, a[:-1]]  # noqa: E731
    for i in range(N):
        F["SOX"][:, i], F["NDX"][:, i], F["NIFTY"][:, i] = sox, ndx, nifty
        F["SOX_L1"][:, i], F["NDX_L1"][:, i] = lag(sox), lag(ndx)
        F["SOXn"][:, i], F["NDXn"][:, i] = sox, ndx
        F["NIFTY_L1"][:, i], F["NIFTY_L2"][:, i] = lag(nifty), lag(lag(nifty))
        F["Y_L1"][:, i], F["Y_L2"][:, i] = lag(Y[:, i]), lag(lag(Y[:, i]))
    Y[0] = np.nan
    ndates = pd.DatetimeIndex(dates)
    return Panel(dates=ndates, n_data=T, tickers=[f"S{i}.NS" for i in range(N)], display=[f"S{i}" for i in range(N)],
                 tiers=np.array(["A", "A", "B", "B", "C", "C"][:N] if N <= 6 else ["B"] * N), markets=["IN"] * N,
                 parents=[None] * N, adrs=[None] * N, Y=Y, F=F,
                 nifty={"y": nifty, "SOX": sox, "NDX": ndx, "NIFTY_L1": lag(nifty), "NIFTY_L2": lag(lag(nifty))},
                 aux_ids=[], same_day_feats=set(), parent_same_day=np.zeros(N, dtype=bool),
                 in_close=ndates.tz_localize("UTC"), us_dates=ndates, us_j=np.arange(T) + 1, future=False)


# ------------------------------------------------------------------------------------------ solvers
def test_eb_shrink_formula():
    b = np.array([0.1, 0.5, 0.3, 0.9, 0.2])
    se = np.array([0.05, 0.2, 0.1, 0.4, 0.05])
    g = np.array(["A"] * 5)
    out = fit.eb_shrink(b, se, g, floor=0.05, min_group=3)
    bbar, s2 = b.mean(), np.mean(se ** 2)
    tau2 = max(np.var(b, ddof=1) - s2, 0.05 * s2)
    w = tau2 / (tau2 + se ** 2)
    np.testing.assert_allclose(out, w * b + (1 - w) * bbar)
    # noisier estimates move further toward the mean
    assert abs(out[3] - bbar) / abs(b[3] - bbar) < abs(out[0] - bbar) / abs(b[0] - bbar)


def test_eb_shrink_small_group_uses_pool():
    b = np.array([0.1, 0.5, 0.3, 0.9])
    se = np.full(4, 0.1)
    g = np.array(["A", "A", "A", "B"])  # tier B has one stock -> shrinks toward all stocks
    out = fit.eb_shrink(b, se, g, floor=0.05, min_group=3)
    pool_mean = b.mean()
    assert out[3] < b[3] and out[3] > pool_mean


def test_simplex_weights_nonnegative_and_normalised():
    rng = np.random.default_rng(1)
    P = rng.normal(size=(500, 4))
    y = 0.3 * P[:, 0] + 0.7 * P[:, 2] + rng.normal(0, 0.01, 500)
    for allow_zero in (True, False):
        w = fit.simplex_weights(P.T @ P, P.T @ y, allow_zero)
        assert np.all(w >= 0)
        assert w.sum() <= 1 + 1e-9
        np.testing.assert_allclose(w, [0.3, 0, 0.7, 0], atol=0.01)
    # predictions too large on average: with the zero forecast allowed the remainder goes to zero, convex sums to one
    y2 = 0.5 * P[:, 1] + rng.normal(0, 0.01, 500)
    wz = fit.simplex_weights(P.T @ P, P.T @ y2, True)
    wc = fit.simplex_weights(P.T @ P, P.T @ y2, False)
    assert abs(wz.sum() - 0.5) < 0.02 and abs(wc.sum() - 1) < 1e-9 and np.all(wc >= 0)


def test_huber_resists_outliers_and_matches_statsmodels():
    import statsmodels.api as sm

    rng = np.random.default_rng(2)
    x = rng.normal(size=400)
    y = 1.0 + 2.0 * x + rng.normal(0, 0.5, 400)
    y[:8] += 25.0
    X = np.column_stack([np.ones(400), x])
    b = fit.huber(X, y, 1.345, 50)
    ref = sm.RLM(y, X, M=sm.robust.norms.HuberT(t=1.345)).fit().params
    np.testing.assert_allclose(b, ref, atol=0.02)
    assert abs(b[1] - 2.0) < 0.1 and abs(fit.lstsq(X, y)[0] - 1.0) > abs(b[0] - 1.0)


def test_ridge_path_matches_closed_form():
    rng = np.random.default_rng(3)
    X = rng.normal(size=(200, 3))
    y = X @ np.array([0.5, -0.2, 0.1]) + rng.normal(0, 0.1, 200)
    Xs = (X - X.mean(0)) / X.std(0)
    yc = y - y.mean()
    B = fit.ridge_path(Xs, yc, [0.0, 0.5])
    for j, lam in enumerate((0.0, 0.5)):
        ref = np.linalg.solve(Xs.T @ Xs / 200 + lam * np.eye(3), Xs.T @ yc / 200)
        np.testing.assert_allclose(B[:, j], ref, atol=1e-10)


# ------------------------------------------------------------------------------------------ walk-forward
def test_no_lookahead_regime_switch():
    """A sensitivity that only exists after a refit date must be invisible to the forecasts made before it."""
    st = settings()
    P0 = synthetic_panel()
    _, refits, _, _ = schedule(P0, st)
    switch = refits[6]
    P = synthetic_panel(beta=np.zeros(6), beta_after=(switch, np.full(6, 2.0)))
    wf = run_walkforward(P, st, log=lambda m: None)
    k = wf.refits.index(switch)
    sox_coef = wf.struct_hist["ols"][:, :, 0]
    assert np.all(np.abs(sox_coef[k]) < 0.15), sox_coef[k]  # fitted strictly before the switch
    assert np.all(sox_coef[k + 1] > sox_coef[k])  # the next refit has 21 post-switch sessions
    # the block right after the switch is forecast with the old (zero) sensitivity, so it misses the new move
    a, b = wf.refits[k], wf.bounds[k]
    miss = P.Y[a:b] - wf.preds["ols"][a:b]
    assert np.corrcoef(miss[:, 0], P.F["SOX"][a:b, 0])[0, 1] > 0.8
    assert np.all(sox_coef[-1] > 1.5)  # the final fit sees the new regime


def test_predictions_only_from_earlier_fits():
    """Perturbing data after a block must leave that block's predictions unchanged."""
    st = settings()
    P = synthetic_panel(seed=4)
    wf = run_walkforward(P, st, log=lambda m: None)
    k = 8
    end = wf.bounds[k]
    P2 = synthetic_panel(seed=4)
    P2.Y[end:] = P2.Y[end:] * -3.0 + 0.05
    wf2 = run_walkforward(P2, st, log=lambda m: None)
    for m in (*LINEAR, "nowcast", "nowcast_pre"):
        np.testing.assert_allclose(wf.preds[m][:end], wf2.preds[m][:end], equal_nan=True)


def test_stacking_uses_only_past_rows():
    st = settings(stack_min_rows=100)
    P = synthetic_panel(seed=5)
    wf = run_walkforward(P, st, log=lambda m: None)
    T, N = P.T, P.N
    cut = wf.refits[10]
    good_late = np.where(np.arange(T)[:, None] >= cut, P.Y, 0.0) + np.zeros((T, N))
    good_early = np.where(np.arange(T)[:, None] < cut, P.Y, 0.0) + np.zeros((T, N))
    wf.preds["late"], wf.preds["early"] = good_late, good_early
    stack(P, wf, st, comps=("late", "early"))
    w_at_cut = wf.weights["hist"][10]["ALL"]
    assert w_at_cut[1] > 0.99  # only the early-perfect component has a track record at the cut
    assert wf.weights["final"]["ALL"][0] > 0.4  # after the cut the late component earns weight


def test_ensemble_is_weighted_average_of_components():
    st = settings()
    P = synthetic_panel(seed=6)
    sections, _ = compute({"factors_aux": []}, None, P, st, log=lambda m: None)
    for m in sections["models"]:
        h1 = next(h for h in m["horizons"] if h["h"] == 1)
        comps = m["components"]
        assert abs(sum(c["weight"] for c in comps.values()) - 1) < 1e-9
        for key in ("SOX", "NDX", "NIFTY"):
            assert abs(sum(c["weight"] * c[key] for c in comps.values()) - h1[key]) < 1e-9
        assert comps["zero"]["SOX"] == 0 and comps["zero"]["NIFTY"] == 0


def test_horizon_block_aggregation():
    a = np.arange(1.0, 11.0)
    a[4] = np.nan
    c = cumsum_h(a, 3)
    assert np.isnan(c[:2]).all() and c[2] == 6.0 and np.isnan(c[4:7]).all() and c[7] == 6 + 7 + 8
    m = np.column_stack([a, 2 * a])
    np.testing.assert_allclose(cumsum_h(m, 3)[:, 1], 2 * c, equal_nan=True)
    assert block_ends(10, 31, 5, 100) == [14, 19, 24, 29]  # non-overlapping, inside the refit block
    assert block_ends(10, 31, 21, 100) == [30]
    assert block_ends(10, 31, 21, 25) == []  # incomplete block at the end of the data is dropped


def test_calibration_coverage_math():
    rng = np.random.default_rng(7)
    T, N = 1200, 5
    resid = rng.normal(0, 0.02, (T, N))
    refits = list(range(200, T, 21)) + [T]
    bounds = refits[1:] + [T]
    block_of = np.full(T, -1)
    for k, (a, b) in enumerate(zip(refits, bounds)):
        block_of[a:b] = k
    wf = WF(refits=refits, bounds=bounds, block_of=block_of, t0=200, preds={}, struct_hist={}, sig={},
            with_parent=np.zeros((len(refits), N), bool), fitted=np.ones((len(refits), N), bool),
            nifty_coef=np.zeros((len(refits), 3)), nifty_pred={}, nifty_sig={}, lam={}, final={}, final_rows={})
    resid_oos = resid.copy()
    resid_oos[:200] = np.nan  # residuals exist only out of sample
    sig = np.full((len(refits), N), 0.02)
    st = settings(band_min_obs=60, band_lookback=250)
    bands = band_offsets(resid_oos, sig, wf, st)
    for lv in (0.5, 0.8, 0.9):
        lo, hi = bands[lv]
        m = np.isfinite(lo)
        cov = np.mean((resid[m] >= lo[m]) & (resid[m] <= hi[m]))
        assert abs(cov - lv) < 0.03, (lv, cov)
    # bands only use residuals realised before the block: the first block after t0 has no history yet
    assert np.isnan(bands[0.9][0][200]).all()


def test_sections_are_json_safe_and_match_contract():
    st = settings(gbm_enabled=True)
    P = synthetic_panel(seed=8)
    sections, diag = compute({"factors_aux": []}, None, P, st, log=lambda m: None)
    text = json.dumps(sanitize({"sections": sections, "diag": diag}), allow_nan=False)
    assert "NaN" not in text and "Infinity" not in text
    clean = sanitize(sections)
    for key, spec in (("models", L(STOCK_MODELS)), ("backtest", BACKTEST), ("factors_aux", L(FACTOR_AUX)), ("nowcast", NOWCAST)):
        errs: list[str] = []
        check(clean[key], spec, key, errs)
        assert not errs, errs[:5]
    bt = clean["backtest"]
    assert len(bt["dates"]) == len(clean["models"][0]["oos_resid"]) == len(bt["nifty_oos_resid"])
    assert {r["model"] for r in bt["summary"]} >= {"zero", "ols", "ensemble", "gbm", "nowcast"}
    zero = next(r for r in bt["summary"] if r["model"] == "zero" and r["mode"] == "scenario" and r["subset"] == "all")
    assert zero["r2"] == 0 and zero["hit"] is None
    assert {h["h"] for h in clean["models"][0]["horizons"]} == {1, 5, 21}
    # in this synthetic world the factor models must beat the no-change forecast out of sample
    ens = next(r for r in bt["summary"] if r["model"] == "ensemble" and r["mode"] == "scenario" and r["subset"] == "all")
    assert ens["r2"] > 0.2


def test_oos_stats_definitions():
    from pipeline.modellab.metrics import oos_stats

    a = np.array([0.01, -0.02, 0.003, 0.04])
    p = np.array([0.02, -0.01, -0.001, 0.0])
    s = oos_stats(a, p, 0.005)
    e = a - p
    assert s["n"] == 4 and abs(s["rmse"] - np.sqrt(np.mean(e ** 2))) < 1e-12
    assert abs(s["r2"] - (1 - (e @ e) / (a @ a))) < 1e-12
    assert s["hit"] == 1.0  # |a| >= 0.5% and p != 0: rows 0 and 1, both signs right
    assert oos_stats(a, np.zeros(4), 0.005)["hit"] is None


@pytest.mark.parametrize("h", [5, 21])
def test_horizon_models_run_on_synthetic(h):
    st = settings()
    P = synthetic_panel(seed=9)
    sections, _ = compute({"factors_aux": []}, None, P, st, log=lambda m: None)
    hz = [x for m in sections["models"] for x in m["horizons"] if x["h"] == h]
    assert len(hz) == P.N and all(np.isfinite(x["SOX"]) for x in hz)
    # cumulative responses keep the 1-session sensitivities (true betas are constant over horizons here)
    true_b = np.linspace(0.1, 0.6, P.N)
    sox = np.array([x["SOX"] for x in hz])
    assert np.corrcoef(sox, true_b)[0, 1] > 0.8
