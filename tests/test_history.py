"""Unit tests for the history module (no network): drawdowns, event-study CAR, contagion math,
Shiller parsing/episodes, JSON safety and an end-to-end build_history on synthetic data."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from pipeline import events as ev
from pipeline import history as hist
from pipeline import shiller

ROOT = Path(__file__).resolve().parents[1]


# ----------------------------------------------------------------------------- helpers
def bdays(start: str, n: int) -> pd.DatetimeIndex:
    return pd.bdate_range(start, periods=n)


def price_frame(close: pd.Series) -> pd.DataFrame:
    return pd.DataFrame({"Close": close.to_numpy(), "AdjClose": close.to_numpy()}, index=close.index)


# ----------------------------------------------------------------------------- drawdowns
def test_drawdown_peak_trough_recovery():
    idx = bdays("2020-01-01", 10)
    s = pd.Series([100, 120, 110, 60, 70, 90, 125, 130, 50, 40], index=idx, dtype=float)
    res = ev.drawdown(s, idx[0], idx[2], idx[5])
    assert res["peak_date"] == idx[1].strftime("%Y-%m-%d")
    assert res["peak"] == 120
    assert res["trough_date"] == idx[3].strftime("%Y-%m-%d")
    assert res["drawdown"] == pytest.approx(60 / 120 - 1)
    assert res["days_to_bottom"] == 2
    # first close >= 120 after the trough is 125 on idx[6] -> 3 trading days after the trough
    assert res["recovered_date"] == idx[6].strftime("%Y-%m-%d")
    assert res["days_to_recover"] == 3


def test_drawdown_not_recovered_and_late_series_note():
    idx = bdays("2020-03-02", 6)
    s = pd.Series([100, 80, 70, 75, 72, 71], index=idx, dtype=float)
    res = ev.drawdown(s, "2020-01-01", idx[1], idx[-1])
    assert res["peak"] == 100 and res["trough"] == 70
    assert res["recovered_date"] is None and res["days_to_recover"] is None
    assert any("series begins" in n for n in res["_notes"])


def test_drawdown_none_when_window_uncovered():
    idx = bdays("2021-01-01", 5)
    s = pd.Series([1, 2, 3, 4, 5], index=idx, dtype=float)
    assert ev.drawdown(s, "2019-01-01", "2019-06-30", "2020-01-01") is None
    assert ev.drawdown(None, "2019-01-01", "2019-06-30", "2020-01-01") is None


# ----------------------------------------------------------------------------- event studies
def _synthetic_pair(n=400, beta=1.5, alpha=0.0005, shock_pos=300, shock=-0.10, seed=7):
    rng = np.random.default_rng(seed)
    idx = bdays("2018-01-01", n)
    m = pd.Series(rng.normal(0, 0.01, n), index=idx)
    noise = rng.normal(0, 0.0005, n)
    r = alpha + beta * m + noise
    r.iloc[shock_pos] += shock
    return pd.Series(r, index=idx), m, idx


def test_market_model_car_recovers_planted_abnormal_return():
    r, m, idx = _synthetic_pair()
    res = ev.market_model_car(r, m, idx[300], day0="same")
    assert res["method"] == "market_model"
    assert res["beta"] == pytest.approx(1.5, abs=0.02)
    assert len(res["car"]) == 66
    assert res["ar0"] == pytest.approx(-0.10, abs=0.003)
    # CAR before the event is ~0, after the event ~ -0.10
    assert abs(res["car"][4]) < 0.01  # day -1
    assert res["car"][5] == pytest.approx(-0.10, abs=0.01)  # day 0
    assert res["car"][-1] == pytest.approx(-0.10, abs=0.02)  # day +60
    assert res["day0_date"] == idx[300].strftime("%Y-%m-%d")


def test_market_model_car_next_day_and_truncation():
    r, m, idx = _synthetic_pair(n=330, shock_pos=301)
    res = ev.market_model_car(r, m, idx[300], day0="next")
    assert res["day0_date"] == idx[301].strftime("%Y-%m-%d")
    assert res["ar0"] == pytest.approx(-0.10, abs=0.003)
    # only 28 post-event days exist -> trailing entries are None, car_end is the last non-null
    assert res["car"][-1] is None
    assert res["car_end"] is not None


def test_market_model_falls_back_to_market_adjusted():
    r, m, idx = _synthetic_pair(n=140, shock_pos=100)
    res = ev.market_model_car(r, m, idx[100], day0="same")
    assert res["method"] == "market_adjusted"
    # market-adjusted AR = r - m (beta forced to 1)
    expected = float(r.iloc[100] - m.iloc[100])
    assert res["ar0"] == pytest.approx(expected, abs=1e-6)  # outputs rounded to 6 dp


def test_abnormal_return_single_day():
    r, m, idx = _synthetic_pair()
    a = ev.abnormal_return(r, m, idx[300])
    assert a["method"] == "market_model"
    assert a["ar"] == pytest.approx(-0.10, abs=0.003)
    assert ev.abnormal_return(r, m, "1990-01-01") is None


def test_mean_path_ignores_none():
    assert ev.mean_path([[1.0, None, 3.0], [3.0, 2.0, None]]) == [2.0, 2.0, 3.0]


# ----------------------------------------------------------------------------- windows & moves
def test_worst_window_and_index_to_peak():
    idx = bdays("2020-01-01", 6)
    r = pd.Series([0.01, -0.05, -0.02, 0.03, -0.04, 0.0], index=idx)
    v, d = ev.worst_window(r, 1)
    assert v == pytest.approx(-0.05) and d == idx[1].strftime("%Y-%m-%d")
    v2, d2 = ev.worst_window(r, 2)
    assert v2 == pytest.approx(-0.07) and d2 == idx[2].strftime("%Y-%m-%d")
    s = pd.Series([50.0, 100.0, 80.0, 40.0], index=bdays("2020-01-01", 4))
    o = ev.index_to_peak(s, s.index[1], 5, 5)
    assert o["t"] == [-1, 0, 1, 2] and o["v"] == [50.0, 100.0, 80.0, 40.0]


def test_log_moves_and_day_return():
    idx = bdays("2021-01-04", 6)  # Mon..Mon
    s = pd.Series([100, 110, 121, 100, 90, 99], index=idx, dtype=float)
    assert ev.log_move(s, idx[0], idx[2]) == pytest.approx(math.log(1.21), abs=1e-6)
    # India-style window: from last close on/before start to first close strictly after end
    assert ev.log_move_next_after(s, idx[0], idx[2]) == pytest.approx(math.log(100 / 100), abs=1e-6)
    assert ev.day_return(s, idx[1]) == pytest.approx(0.10, abs=1e-6)
    assert ev.day_return(s, "2021-01-02") is None  # weekend
    assert ev.log_move(s, "2019-01-01", idx[2]) is None  # stale start guarded


# ----------------------------------------------------------------------------- quantity & json
def test_quantity_product_and_worst_status():
    q = ev.quantity(
        "calib.x",
        "x",
        [
            {"label": "a", "value": -0.02, "status": "COMPUTED", "src": ["hist_yahoo"]},
            {"label": "b", "value": 1 / -0.77, "status": "SOURCED", "src": ["s1"]},
        ],
        unit="x",
    )
    assert q["value"] == pytest.approx(0.02 / 0.77)
    assert q["status"] == "SOURCED"
    assert q["src"] == ["hist_yahoo", "s1"]
    assert set(q) == {"id", "label", "value", "unit", "status", "parts", "src", "note", "editable", "min", "max", "step"}


def test_json_safe_strips_nan_inf_and_numpy():
    obj = {"a": np.float64("nan"), "b": [np.int64(3), float("inf")], "c": np.bool_(True), "d": pd.Timestamp("2020-01-02")}
    out = ev.json_safe(obj)
    assert out == {"a": None, "b": [3, None], "c": True, "d": "2020-01-02"}
    json.dumps(out, allow_nan=False)


# ----------------------------------------------------------------------------- Shiller
def test_shiller_date_parse():
    assert shiller._parse_date(1871.01) == pd.Timestamp("1871-01-01")
    assert shiller._parse_date(1871.1) == pd.Timestamp("1871-10-01")  # .1 means October
    assert shiller._parse_date(1999.12) == pd.Timestamp("1999-12-01")
    assert shiller._parse_date("Sept price is Sept 1st close") is None


def test_shiller_parse_and_episode():
    dates = [1999 + (m // 12) + ((m % 12) + 1) / 100 for m in range(48)]  # 1999.01 .. 2002.12
    p = np.linspace(100, 160, 20).tolist() + np.linspace(150, 80, 28).tolist()
    raw = pd.DataFrame(
        {
            "Date": dates,
            "P": p,
            "D": 1.0,
            "E": 5.0,
            "CPI": 100.0,
            "Fraction": 0.0,
            "Rate GS10": 5.0,
            "Price": [x * 1.1 for x in p],
            "Dividend": 1.0,
            "Price.1": 0.0,
            "Earnings": 5.0,
            "Earnings.1": 5.0,
            "CAPE": 40.0,
        }
    )
    df = shiller.parse_frame(raw)
    assert df.index[0] == pd.Timestamp("1999-01-01") and len(df) == 48
    spec = {"id": "x", "label": "X", "peak_search": ["1999-01", "2000-12"], "trough_end": "2002-12"}
    pt = shiller.episode(df, spec, "hist_shiller_ie")
    assert pt["peak_date"] == "2000-08-01"  # 20th month
    assert pt["pe"] == pytest.approx(160 / 5.0)
    assert pt["drawdown"] == pytest.approx(80 / 160 - 1)
    assert pt["pe_status"] == "COMPUTED" and pt["drawdown_status"] == "COMPUTED"
    assert "CAPE 40.0" in pt["note"]
    assert pt["_real_drawdown"] == pytest.approx(80 / 160 - 1)


# ----------------------------------------------------------------------------- config integrity
def test_history_yaml_src_ids_resolve_and_schema():
    h = yaml.safe_load(open(ROOT / "history.yaml"))["history"]
    ids = {s["id"] for s in h["sources"]}
    assert len(ids) == len(h["sources"]), "duplicate source ids"
    for s in h["sources"]:
        assert s["verification"] in {"PRIMARY", "SECONDARY", "UNVERIFIED"}
        assert s["url"].startswith("http")
    refs: list[str] = []
    for c in h["cases"]:
        refs += c.get("src", [])
        assert set(c["crash_types"]) <= {"earnings_collapse", "multiple_compression", "fraud_trust", "credit_liquidity", "capex_overbuild"}
        for d in c.get("drawdowns", []):
            refs += d.get("src", [])
            assert ("sourced" in d and d.get("src")) or ("ticker" in d and len(d["peak_search"]) == 2)
    for e in h["event_studies"]:
        refs += e.get("src", [])
        for g in e["groups"]:
            assert g["day0"] in {"same", "next"}
    for p in h["pe_points"]:
        refs += p["src"]
    refs += h["contagion"]["us"]["src"] + h["contagion"]["india"]["src"]
    missing = sorted(set(refs) - ids)
    assert not missing, f"unresolved source ids: {missing}"


def test_expand_members_and_market_of():
    targets = {"INFY.NS": {"tier": "B"}, "NETWEB.NS": {"tier": "C"}, "SIFY": {"tier": "C"}}
    origins = {"NVDA": {"group": "chips"}, "MSFT": {"group": "hyperscalers"}, "SMCI": {"group": "chips"}}
    assert hist.expand_members(["@tier:C", "SMCI", "@origins:chips"], targets, origins) == ["NETWEB.NS", "SIFY", "SMCI", "NVDA"]
    assert set(hist.expand_members(["@tier:ALL"], targets, origins)) == set(targets)
    assert hist.market_of("INFY.NS") == "IN" and hist.market_of("MOSCHIP.BO") == "IN"
    assert hist.market_of("^NSEI") == "IN" and hist.market_of("^GSPC") == "US"
    assert hist.market_of("6501.T") == "JP" and hist.market_of("SIFY") == "US"
    # member listed in another market than the group's index gets its local index
    assert hist._member_setup("SIFY", "^NSEI", "next") == ("^GSPC", "same", " (vs S&P 500)")
    assert hist._member_setup("INFY.NS", "^NSEI", "next") == ("^NSEI", "next", "")


# ----------------------------------------------------------------------------- end-to-end (synthetic)
class FakeCtx:
    """Synthetic BuildContext: US tickers on US business days, India tickers on India business days."""

    def __init__(self):
        rng = np.random.default_rng(11)
        self.us_idx = pd.bdate_range("2023-01-02", "2026-10-27")
        self.in_idx = pd.bdate_range("2023-01-02", "2026-10-28")
        self._p: dict[str, pd.Series] = {}

        def walk(idx, vol, beta=None, base=None, shock=None):
            r = rng.normal(0, vol, len(idx))
            if beta is not None:
                r = beta * base + rng.normal(0, vol / 3, len(idx))
            if shock:
                for d, s in shock.items():
                    r[idx.get_loc(pd.Timestamp(d))] += s
            return pd.Series(100 * np.exp(np.cumsum(r)), index=idx), r

        spx, spx_r = walk(self.us_idx, 0.01)
        self._p["^GSPC"] = spx
        sox, sox_r = walk(self.us_idx, 0.0, beta=1.6, base=spx_r, shock={"2025-01-27": -0.09})
        self._p["^SOX"] = sox
        self._p["^NDX"], _ = walk(self.us_idx, 0.0, beta=1.2, base=spx_r)
        self._p["^IXIC"], _ = walk(self.us_idx, 0.0, beta=1.1, base=spx_r)
        self._p["SMCI"], _ = walk(self.us_idx, 0.0, beta=2.0, base=spx_r, shock={"2024-10-30": -0.40})
        self._p["NVDA"], _ = walk(self.us_idx, 0.0, beta=1.8, base=spx_r, shock={"2024-10-30": -0.02})
        self._p["AMD"], _ = walk(self.us_idx, 0.0, beta=1.7, base=spx_r, shock={"2024-10-30": -0.01})
        nifty, nifty_r = walk(self.in_idx, 0.008)
        self._p["^NSEI"] = nifty
        self._p["^BSESN"], _ = walk(self.in_idx, 0.0, beta=1.0, base=nifty_r)
        self._p["^CNXIT"], _ = walk(self.in_idx, 0.0, beta=0.9, base=nifty_r)
        self._p["INFY.NS"], _ = walk(self.in_idx, 0.0, beta=0.8, base=nifty_r, shock={"2025-01-28": -0.05})
        self._p["NETWEB.NS"], _ = walk(self.in_idx, 0.0, beta=1.3, base=nifty_r, shock={"2025-01-27": -0.08})
        self._p["SIFY"], _ = walk(self.us_idx, 0.02)
        self.india_dates = self.in_idx
        self.window = (pd.Timestamp("2023-10-30"), pd.Timestamp("2026-10-28"))
        self.targets = [
            {"ticker": "INFY.NS", "display": "INFY", "name": "Infosys", "tier": "B", "parent": None},
            {"ticker": "NETWEB.NS", "display": "NETWEB", "name": "Netweb", "tier": "C", "parent": None},
            {"ticker": "SIFY", "display": "SIFY", "name": "Sify", "tier": "C", "parent": None, "market": "US"},
        ]
        self.origins = [
            {"ticker": "NVDA", "name": "NVIDIA", "group": "chips"},
            {"ticker": "AMD", "name": "AMD", "group": "chips"},
            {"ticker": "SMCI", "name": "Super Micro", "group": "chips"},
        ]
        self.securities = {
            "NVDA": {"mcap_usd": 3e12, "pe_ttm": 30.0, "pe_pre_chatgpt_median": 50.0},
            "AMD": {"mcap_usd": 1e12, "pe_ttm": 60.0, "pe_pre_chatgpt_median": None},
            "SMCI": {"mcap_usd": 2e10, "pe_ttm": -5.0, "pe_pre_chatgpt_median": 15.0},
        }
        self.usd_inr = 95.0
        self.cfg = {
            "replay_windows": [{"id": "DEEPSEEK", "label": "DeepSeek day", "start": "2025-01-24", "end": "2025-01-27"}],
            "history": {
                "accessed": "2026-10-28",
                "sources": [
                    {"id": "hist_yahoo", "title": "Yahoo", "url": "https://finance.yahoo.com/", "verification": "PRIMARY"},
                    {"id": "s_sat", "title": "Satyam", "url": "https://example.org/satyam", "verification": "SECONDARY", "quote": "77%"},
                ],
                "cases": [
                    {
                        "id": "deepseek",
                        "name": "DeepSeek",
                        "period": "2025",
                        "what_broke": "x",
                        "crash_types": ["multiple_compression"],
                        "linked": "",
                        "india": "",
                        "src": [],
                        "drawdowns": [
                            {"ticker": "^SOX", "label": "SOX", "peak_search": ["2025-01-24", "2025-01-24"], "trough_end": "2025-01-31"},
                            {"ticker": "MISSING", "label": "nope", "peak_search": ["2025-01-24", "2025-01-24"], "trough_end": "2025-01-31"},
                            {"label": "Satyam", "src": ["s_sat"], "sourced": {"peak_date": "2009-01-06", "trough_date": "2009-01-07", "drawdown": -0.77}},
                        ],
                        "computed_moves": [{"ticker": "^SOX", "date": "2025-01-27", "label": "SOX"}],
                    }
                ],
                "event_studies": [
                    {
                        "id": "es_deepseek",
                        "label": "DeepSeek",
                        "date": "2025-01-27",
                        "crash_types": ["multiple_compression"],
                        "src": ["hist_yahoo"],
                        "groups": [
                            {"name": "US", "index": "^GSPC", "day0": "same", "members": ["@origins:chips"]},
                            {"name": "India", "index": "^NSEI", "day0": "next", "members": ["@tier:ALL"]},
                        ],
                    }
                ],
                "scatter_events": [{"id": "es_deepseek", "us_date": "2025-01-27"}],
                "shiller": {"src": "hist_shiller_ie", "episodes": []},
                "pe_points": [
                    {"id": "p1", "label": "P1", "market": "US", "pe": 40, "pe_kind": "trailing", "src": ["hist_yahoo"], "drawdown_from": {"ticker": "^NDX", "peak_search": ["2024-01-01", "2024-12-31"], "trough_end": "2026-10-27"}},
                    {"id": "p2", "label": "P2", "market": "IN", "pe": 20, "pe_kind": "trailing", "src": ["hist_yahoo"], "drawdown_from": {"ticker": "^NSEI", "peak_search": ["2024-01-01", "2024-12-31"], "trough_end": "2026-10-27"}},
                    {"id": "p3", "label": "P3", "market": "US", "pe": 60, "pe_kind": "trailing", "src": ["hist_yahoo"], "drawdown_from": {"ticker": "^SOX", "peak_search": ["2024-01-01", "2024-12-31"], "trough_end": "2026-10-27"}},
                ],
                "overlay": {"span": 50, "dotcom": [{"ticker": "^IXIC", "label": "IXIC", "peak_search": ["2024-01-01", "2024-12-31"]}], "today": [{"ticker": "^SOX", "label": "SOX"}]},
                "worst_windows": {"since": "2023-01-02", "series": {"SOX": "^SOX", "NDX": "^NDX"}},
                "deepseek_next_day": {"d0": "2025-01-27", "d1": "2025-01-28", "index_in": "^NSEI", "index_us": "^GSPC"},
                "contagion": {
                    "us": {"event": "2024-10-30", "company": "SMCI", "index": "^GSPC", "peers": "@origins:chips", "src": ["hist_yahoo"]},
                    "india": {"event": "2025-01-28", "index": "^NSEI", "peers": ["INFY.NS"], "company_move": -0.77, "src": ["s_sat"]},
                },
            },
        }

    def prices(self, t):
        s = self._p.get(t)
        return price_frame(s) if s is not None else None

    def logret(self, t):
        s = self._p.get(t)
        return None if s is None else np.log(s).diff().dropna()

    def aligned_to_india(self, t):
        r = self.logret(t)
        if r is None:
            return None
        pos = self.in_idx.searchsorted(r.index, side="right")  # US close -> next India day
        ok = pos < len(self.in_idx)
        out = pd.Series(r.to_numpy()[ok], index=self.in_idx[pos[ok]]).groupby(level=0).sum()
        return out.reindex(self.in_idx).fillna(0.0)

    def source_ids(self):
        return set()


@pytest.fixture()
def built(monkeypatch):
    monkeypatch.setattr(hist.shiller, "fetch_shiller", lambda *a, **k: None)
    return hist.build_history(FakeCtx())


def test_build_history_end_to_end_contract(built):
    section, calib, srcs = built
    json.dumps({"h": section, "c": calib, "s": srcs}, allow_nan=False)
    assert set(section) == {
        "cases", "event_studies", "us_vs_india", "pe_vs_drawdown", "pe_fit", "ai_basket_pe",
        "overlay", "worst_windows", "replay_windows", "deepseek_next_day",
    }
    case = section["cases"][0]
    assert set(case) == {"id", "name", "period", "what_broke", "crash_types", "drawdowns", "linked", "india", "src", "notes"}
    statuses = [d["status"] for d in case["drawdowns"]]
    assert statuses == ["COMPUTED", "SOURCED"]  # missing ticker omitted, noted
    assert any("MISSING" in n for n in case["notes"]) and any(n.startswith("COMPUTED:") for n in case["notes"])
    dd_keys = {"label", "ticker", "peak_date", "peak", "trough_date", "trough", "drawdown", "days_to_bottom", "days_to_recover", "recovered_date", "status", "src", "note"}
    assert all(set(d) == dd_keys for d in case["drawdowns"])
    # event study shapes
    es = section["event_studies"][0]
    assert es["window"] == [-5, 60]
    for g in es["groups"]:
        assert len(g["mean_car"]) == 66
        for m in g["members"]:
            assert set(m) == {"ticker", "label", "tier", "car", "ar0", "ar1", "car_end", "method"}
            assert len(m["car"]) == 66
    india = es["groups"][1]
    sify = next(m for m in india["members"] if m["ticker"] == "SIFY")
    assert "(vs S&P 500)" in sify["label"]
    netweb = next(m for m in india["members"] if m["ticker"] == "NETWEB.NS")
    assert netweb["ar0"] is not None


def test_build_history_scatter_and_tables(built):
    section, _, _ = built
    pts = section["us_vs_india"]
    assert pts and set(pts[0]) == {"date", "us_date", "event", "x_sox", "ticker", "tier", "r"}
    ev_pts = [p for p in pts if p["event"] == "es_deepseek"]
    assert ev_pts and all(p["date"] == "2025-01-28" for p in ev_pts)
    sify = [p for p in ev_pts if p["ticker"] == "SIFY"]
    assert sify and sify[0]["us_date"] == "2025-01-27"
    dsk = {r["ticker"]: r for r in section["deepseek_next_day"]}
    assert dsk["INFY.NS"]["r_jan28"] == pytest.approx(math.expm1(np.log(FakeCtx()._p["INFY.NS"]).diff().loc["2025-01-28"]), abs=1e-6)
    assert dsk["INFY.NS"]["ar_jan28"] < -0.03
    rw = section["replay_windows"][0]
    assert rw["status"] == "COMPUTED" and rw["moves"]["SOX"] is not None and rw["moves"]["NIFTY"] is not None
    assert set(section["worst_windows"]["SOX"]) == {"d1", "d1_date", "d21", "d21_end", "d252", "d252_end"}
    assert section["overlay"] and all(len(o["t"]) == len(o["v"]) for o in section["overlay"])
    assert all(o["v"][o["t"].index(0)] == 100.0 for o in section["overlay"])


def test_build_history_pe_fit_and_basket(built):
    section, _, _ = built
    pts = section["pe_vs_drawdown"]
    assert [p["id"] for p in pts] == ["p1", "p2", "p3"]
    assert all(not any(k.startswith("_") for k in p) for p in pts)
    fit = section["pe_fit"]
    x = np.array([p["pe"] for p in pts])
    y = np.array([p["drawdown"] for p in pts])
    b, a = np.polyfit(x, y, 1)
    assert fit["slope"] == pytest.approx(b) and fit["intercept"] == pytest.approx(a) and fit["n"] == 3
    basket = section["ai_basket_pe"]
    # now: NVDA + AMD (SMCI excluded: negative EPS); harmonic cap-weighted
    assert basket["now"] == pytest.approx(4e12 / (3e12 / 30 + 1e12 / 60), abs=1e-3)  # rounded to 3 dp
    # pre: NVDA + SMCI (AMD has no pre-ChatGPT median)
    assert basket["pre_chatgpt_median"] == pytest.approx((3e12 + 2e10) / (3e12 / 50 + 2e10 / 15), abs=1e-3)
    lo = min(0.0, fit["intercept"] + fit["slope"] * basket["now"])
    assert basket["implied_drawdown"] == pytest.approx(max(-0.99, lo), abs=1e-4)  # uses the unrounded P/E


def test_contagion_quantities(built):
    _, calib, _ = built
    us = calib["contagion_us"]
    assert us["id"] == "calib.contagion_us" and us["status"] == "COMPUTED"
    med_peer, inv_target = (p["value"] for p in us["parts"])
    assert us["value"] == pytest.approx(med_peer * inv_target)
    assert inv_target < 0 and 0 < us["value"] < 0.2  # planted -2%/-1% peers vs -40% target
    ind = calib["contagion_india"]
    assert ind["status"] == "SOURCED"  # worst of COMPUTED and the SOURCED Satyam move
    assert ind["parts"][1]["value"] == pytest.approx(1 / -0.77)
    assert ind["value"] == pytest.approx(ind["parts"][0]["value"] / -0.77)


def test_extra_sources_shape(built):
    _, _, srcs = built
    keys = {"id", "title", "publisher", "url", "date", "quote", "verification", "accessed", "note"}
    assert srcs and all(set(s) == keys for s in srcs)
    assert all(s["accessed"] == "2026-10-28" for s in srcs)
