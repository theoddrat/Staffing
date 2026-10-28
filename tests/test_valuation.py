"""Valuation math: Price = P/E x EPS, Move = (1-e)(1-d)-1, operating leverage, AI premium,
TTM EPS without look-ahead, pre-ChatGPT median window, quantity provenance."""
import math

import numpy as np
import pandas as pd
import pytest

from pipeline import fundamentals as F
from pipeline.config import build_quantity, worst_status


def test_price_equals_pe_times_eps_and_move_formula():
    assert F.price_from(25.0, 4.0) == 100.0
    assert F.move(0.0, 0.0) == 0.0
    assert F.move(0.2, 0.25) == pytest.approx(-0.4)  # 0.8 * 0.75 - 1
    assert F.move(0.2, 0.0) == pytest.approx(-0.2)
    # waterfall consistency: P1 = PE0 * EPS0 * (1-e) * (1-d)
    pe0, eps0, e, d = 30.0, 5.0, 0.15, 0.3
    p0 = F.price_from(pe0, eps0)
    p1 = F.price_from(pe0 * (1 - d), eps0 * (1 - e))
    assert p1 / p0 - 1 == pytest.approx(F.move(e, d))


def test_operating_leverage_incremental_over_current():
    idx = pd.to_datetime(["2024-12-31", "2025-12-31"])
    rev = pd.Series([100.0, 120.0], idx)
    ebit = pd.Series([20.0, 30.0], idx)
    ol, method, status = F.operating_leverage(rev, ebit, 0.6, 0.25)
    assert ol == pytest.approx((10 / 20) / (30 / 120))  # incremental 0.5 / current 0.25 = 2.0
    assert status == "COMPUTED" and "incremental" in method


def test_operating_leverage_clamps_and_fallbacks():
    idx = pd.to_datetime(["2024-12-31", "2025-12-31"])
    # very high incremental margin -> clamp at 4
    ol, _, _ = F.operating_leverage(pd.Series([100.0, 110.0], idx), pd.Series([1.0, 9.0], idx), None, None)
    assert ol == 4.0
    # incremental below current -> clamp at 1
    ol, _, _ = F.operating_leverage(pd.Series([100.0, 200.0], idx), pd.Series([50.0, 60.0], idx), None, None)
    assert ol == 1.0
    # revenue change < 2% -> gross/operating margin fallback
    ol, method, status = F.operating_leverage(pd.Series([100.0, 101.0], idx), pd.Series([20.0, 22.0], idx), 0.6, 0.2)
    assert ol == pytest.approx(3.0) and "fallback" in method and status == "COMPUTED"
    # negative EBIT and no margins -> USER_ASSUMPTION default
    ol, method, status = F.operating_leverage(pd.Series([100.0, 130.0], idx), pd.Series([5.0, -2.0], idx), None, None, default=1.5)
    assert ol == 1.5 and status == "USER_ASSUMPTION"


def test_ai_premium():
    assert F.ai_premium(30.0, 20.0) == pytest.approx(0.5)
    assert F.ai_premium(15.0, 30.0) == pytest.approx(-0.5)
    assert F.ai_premium(None, 20.0) is None
    assert F.ai_premium(-5.0, 20.0) is None
    assert F.ai_premium(20.0, 0.0) is None


def test_ttm_eps_has_no_look_ahead():
    rep = pd.Series([1.0, 1.0, 1.0, 1.0, 2.0],
                    index=pd.to_datetime(["2025-02-01", "2025-05-01", "2025-08-01", "2025-11-01", "2026-02-01"]))
    dates = pd.to_datetime(["2025-10-31", "2025-11-01", "2025-11-03", "2026-02-01", "2026-02-02"])
    ttm = F.ttm_eps_series(rep, pd.DatetimeIndex(dates))
    assert math.isnan(ttm.iloc[0])  # only 3 reports known
    assert math.isnan(ttm.iloc[1])  # 4th report announced that day: not yet usable
    assert ttm.iloc[2] == pytest.approx(4.0)
    assert ttm.iloc[3] == pytest.approx(4.0)  # 5th report announced 2026-02-01: not yet usable
    assert ttm.iloc[4] == pytest.approx(5.0)  # 1 + 1 + 1 + 2


def test_ttm_eps_requires_consecutive_quarters():
    rep = pd.Series([1.0, 1.0, 1.0, 1.0], index=pd.to_datetime(["2023-01-01", "2023-04-01", "2023-07-01", "2024-09-01"]))
    ttm = F.ttm_eps_series(rep, pd.DatetimeIndex(pd.to_datetime(["2024-09-05"])))
    assert math.isnan(ttm.iloc[0])  # 4 reports span > 400 days -> not a valid TTM


def test_pe_series_and_pre_chatgpt_median_window():
    idx = pd.bdate_range("2019-06-01", "2023-06-30")
    close = pd.Series(100.0, index=idx)
    eps = pd.Series(np.where(idx < pd.Timestamp("2022-11-30"), 5.0, 2.0), index=idx)  # P/E 20 before, 50 after
    eps.iloc[:10] = -1.0
    pe = F.pe_series(close, eps)
    assert pe.iloc[:10].isna().all()  # EPS <= 0 -> undefined P/E
    med, n = F.pre_chatgpt_median(pe, "2022-11-30", years=3, min_obs=250)
    assert med == pytest.approx(20.0)  # window [2019-11-30, 2022-11-30) excludes the post-launch 50x
    assert n == len(pd.bdate_range("2019-12-02", "2022-11-29"))
    short = F.pre_chatgpt_median(pe[pe.index >= "2022-06-01"], "2022-11-30", min_obs=250)
    assert short[0] is None


def test_ttm_sum_and_ret_since():
    q = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0], index=pd.to_datetime(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]))
    assert F.ttm_sum(q) == pytest.approx(14.0)
    gap = q.drop(pd.Timestamp("2025-12-31"))
    assert F.ttm_sum(gap) is None  # 2025-06..2026-03 with a missing quarter spans > 300 days
    c = pd.Series([100.0, 110.0, 121.0], index=pd.to_datetime(["2022-11-29", "2022-11-30", "2026-10-27"]))
    assert F.ret_since(c, "2022-11-30") == pytest.approx(0.1)


def test_earnings_table_local_dates():
    raw = pd.DataFrame({"Reported EPS": [2.22, None, 1.87]},
                       index=pd.DatetimeIndex(["2026-08-26 16:00", "2026-11-17 15:00", "2026-05-20 16:00"]).tz_localize("America/New_York"))
    s = F.earnings_table(raw, "America/New_York")
    assert list(s.index.strftime("%Y-%m-%d")) == ["2026-05-20", "2026-08-26"]
    ind = pd.DataFrame({"Reported EPS": [8.92]}, index=pd.DatetimeIndex(["2018-07-13 06:00"]).tz_localize("America/New_York"))
    s2 = F.earnings_table(ind, "Asia/Kolkata")
    assert s2.index[0] == pd.Timestamp("2018-07-13")  # 06:00 ET = 15:30 IST same day


def test_quantity_product_and_worst_status():
    q = build_quantity("X.hyperscaler_share", {
        "label": "share",
        "parts": [
            {"label": "sourced share", "value": 0.58, "status": "SOURCED", "src": ["a"]},
            {"label": "assumed fraction", "value": 0.5, "status": "USER_ASSUMPTION"},
        ]}, "frac")
    assert q["value"] == pytest.approx(0.29)
    assert q["status"] == "USER_ASSUMPTION" and q["editable"] is True
    assert q["src"] == ["a"]
    q2 = build_quantity("HFCL.NS.exposure.capex", {"label": "contract / revenue", "parts": [
        {"label": "annual contract (cr)", "value": 2000.0, "status": "SOURCED", "src": ["b"]},
        {"label": "1/revenue", "value_from": "inv_revenue_ttm_cr", "status": "COMPUTED"}]},
        "frac", resolvers={"inv_revenue_ttm_cr": lambda: 1 / 8000.0})
    assert q2["value"] == pytest.approx(0.25) and q2["status"] == "SOURCED"
    assert worst_status(["COMPUTED", "UNVERIFIED", "SOURCED"]) == "UNVERIFIED"
