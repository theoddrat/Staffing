"""Regression machinery: OLS + HAC t-stats, downside subsets, rolling windows, beta_total,
and an end-to-end check that the lagged-US model recovers a known transmission beta."""
import numpy as np
import pandas as pd
import pytest
import statsmodels.api as sm

from pipeline import model, stats
from tests.conftest import MARKETS

RNG = np.random.default_rng(7)


def _frame(n=1500, b=(0.5, -0.2), noise=0.01, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2018-01-01", periods=n)
    x1 = rng.normal(0, 0.02, n)
    x2 = rng.normal(0, 0.015, n)
    y = 0.0003 + b[0] * x1 + b[1] * x2 + rng.normal(0, noise, n)
    return pd.Series(y, index=idx), pd.DataFrame({"SOX": x1, "NDX": x2}, index=idx)


def test_ols_recovers_known_betas_and_matches_statsmodels_hac():
    y, X = _frame()
    res = stats.ols(y, X, hac_lags=5, spec="test")
    assert res["n"] == len(y)
    assert res["coef"]["SOX"]["b"] == pytest.approx(0.5, abs=0.03)
    assert res["coef"]["NDX"]["b"] == pytest.approx(-0.2, abs=0.04)
    ref = sm.OLS(y.to_numpy(), sm.add_constant(X.to_numpy())).fit(cov_type="HAC", cov_kwds={"maxlags": 5})
    assert res["coef"]["SOX"]["t"] == pytest.approx(ref.tvalues[1], rel=1e-9)
    assert res["coef"]["NDX"]["p"] == pytest.approx(ref.pvalues[2], rel=1e-9)
    ols_ref = sm.OLS(y.to_numpy(), sm.add_constant(X.to_numpy())).fit()
    assert res["coef"]["SOX"]["se"] == pytest.approx(ols_ref.bse[1], rel=1e-9)
    assert res["r2"] == pytest.approx(ols_ref.rsquared, rel=1e-9)
    assert stats.public(res).keys() >= {"spec", "n", "coef", "r2", "adj_r2", "resid_sd"}
    assert "_resid" not in stats.public(res)


def test_ols_drops_nans_and_needs_enough_rows():
    y, X = _frame(n=200)
    y.iloc[:50] = np.nan
    res = stats.ols(y, X)
    assert res["n"] == 150
    assert stats.ols(y.iloc[:8], X.iloc[:8]) is None


def test_downside_mask_selects_worst_five_percent():
    x = pd.Series(np.arange(1000, dtype=float))
    m = stats.downside_mask(x, 0.05)
    assert m.sum() == 50
    assert x[m].max() < x[~m].min()


def test_rolling_ols_detects_beta_break_and_respects_min_obs():
    n = 1200
    rng = np.random.default_rng(3)
    idx = pd.bdate_range("2016-01-01", periods=n)
    x = rng.normal(0, 0.02, n)
    beta = np.where(np.arange(n) < n // 2, 0.2, 0.8)
    y = beta * x + rng.normal(0, 0.005, n)
    out = stats.rolling_ols(pd.Series(y, idx), pd.DataFrame({"SOX": x}, idx), window=252, step=5, min_obs=200)
    assert len(out["dates"]) == len(out["SOX"]) == len(out["r2"])
    early = [b for d, b in zip(out["dates"], out["SOX"]) if d < str(idx[n // 2 - 10].date())]
    late = [b for d, b in zip(out["dates"], out["SOX"]) if d > str(idx[n // 2 + 260].date())]
    assert np.mean(early) == pytest.approx(0.2, abs=0.05)
    assert np.mean(late) == pytest.approx(0.8, abs=0.05)
    y2 = pd.Series(y, idx).copy()
    y2.iloc[:400] = np.nan  # too few valid rows in the first windows -> None
    out2 = stats.rolling_ols(y2, pd.DataFrame({"SOX": x}, idx), window=252, step=5, min_obs=200)
    assert out2["SOX"][0] is None


def test_beta_total_formula():
    coef = {"SOX": {"b": 0.3}, "NDX": {"b": 0.2}, "PARENT": {"b": 0.5}, "NIFTY": {"b": 0.9}}
    # 0.3 + 0.2*0.6 + 0.5*0.4 + 0.9*(0.05 + 0.1*0.6)
    assert stats.beta_total(coef, 0.6, 0.4, 0.05, 0.1) == pytest.approx(0.3 + 0.12 + 0.2 + 0.9 * 0.11)
    no_parent = {k: v for k, v in coef.items() if k != "PARENT"}
    assert stats.beta_total(no_parent, 0.6, None, 0.05, 0.1) == pytest.approx(0.3 + 0.12 + 0.9 * 0.11)


def test_slope_equals_cov_over_var():
    x = pd.Series(RNG.normal(size=500))
    y = 2.5 * x + RNG.normal(scale=0.1, size=500)
    assert stats.slope(y, x) == pytest.approx(np.cov(y, x, bias=True)[0, 1] / np.var(x))


def test_end_to_end_lagged_us_transmission_is_recovered():
    """India stock = 0.4 * (previous US SOX session) + 0.9 * same-day Nifty + noise.
    The estimator must align SOX by one India day and recover both betas."""
    rng = np.random.default_rng(11)
    us_days = pd.bdate_range("2021-01-01", "2026-10-23")
    in_days = us_days.delete(np.arange(37, len(us_days), 61))  # sprinkle India-only holidays
    sox = pd.Series(rng.normal(0, 0.02, len(us_days)), us_days)
    ndx = pd.Series(0.5 * sox.to_numpy() + rng.normal(0, 0.01, len(us_days)), us_days)
    cfg = {"settings": {"history_start": "2022-01-01", "hac_lags": 5, "downside_quantile": 0.05,
                        "downside_min_obs": 25, "rolling_window": 252, "rolling_step": 5, "rolling_min_obs": 200},
           "markets": MARKETS}
    from pipeline.align import align_series

    x_sox, _ = align_series(in_days, MARKETS["IN"], sox, MARKETS["US"])
    x_ndx, _ = align_series(in_days, MARKETS["IN"], ndx, MARKETS["US"])
    nifty = pd.Series(0.3 * x_sox.fillna(0).to_numpy() + rng.normal(0, 0.008, len(in_days)), in_days)
    stock = pd.Series(0.4 * x_sox.fillna(0).to_numpy() + 0.9 * nifty.to_numpy() + rng.normal(0, 0.01, len(in_days)), in_days)
    series = {"^SOX": sox, "^NDX": ndx, "^NSEI": nifty, "TEST.NS": stock}
    mk = {"^SOX": "US", "^NDX": "US", "^NSEI": "IN", "TEST.NS": "IN"}
    window = (in_days[in_days.searchsorted(in_days[-1] - pd.DateOffset(years=3))], in_days[-1])
    est = model.Estimator(cfg, series.get, mk.get, window, in_days)
    nm = model.nifty_model(est)
    assert nm["main"]["coef"]["SOX"]["b"] == pytest.approx(0.3, abs=0.05)
    res = model.target_model(est, "TEST.NS", None, nm)
    c = res["reg"]["coef"]
    assert c["SOX"]["b"] == pytest.approx(0.4, abs=0.06)
    assert c["NIFTY"]["b"] == pytest.approx(0.9, abs=0.06)
    assert c["NDX"]["b"] == pytest.approx(0.0, abs=0.1)
    assert res["beta_total"] == pytest.approx(0.4 + 0.9 * 0.3, abs=0.1)
    assert res["rolling"]["dates"] and len(res["rolling"]["SOX"]) == len(res["rolling"]["dates"])
    # A same-day (unlagged) SOX regressor would show ~no relation -> the lag matters.
    same_day = sox.reindex(in_days)
    r0 = stats.ols(stock, pd.DataFrame({"SOX0": same_day}), 5)
    assert abs(r0["coef"]["SOX0"]["b"]) < 0.1
