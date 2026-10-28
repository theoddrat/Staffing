"""Assemble public/data.json (src/types/data.ts) from universe.yaml + cached Yahoo data.

Implements pipeline.context.BuildContext (`CoreContext`) and calls pipeline.history.build_history(ctx)
behind a guard so the core bundle is always produced.
"""
from __future__ import annotations

import math
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline import calibration, fetch_fund, fx as fxmod, model, stats
from pipeline.align import align_series, close_timestamps
from pipeline.config import ROOT, build_quantity, computed_quantity, load_universe
from pipeline.export import sanitize, write_json
from pipeline.fundamentals import compute_security_fundamentals, fnum, ret_since
from pipeline.prices import get_history, log_returns
from pipeline.validate import validate_bundle

SCHEMA_VERSION = 1
ACCESSED = "2026-10-28"
OUT = ROOT / "public" / "data.json"

SUFFIX_MARKET = {".NS": "IN", ".BO": "IN", ".T": "JP", ".DE": "DE", ".SW": "CH", ".PA": "FR"}
MARKET_CCY = {"US": "USD", "IN": "INR", "JP": "JPY", "DE": "EUR", "FR": "EUR", "CH": "CHF", "TW": "TWD", "NL": "EUR"}


def infer_market(ticker: str) -> str:
    if ticker in ("^NSEI", "^CNXIT", "^BSESN"):
        return "IN"
    if ticker == "^N225":
        return "JP"
    if ticker.endswith("=X"):
        return "FX"
    for suf, m in SUFFIX_MARKET.items():
        if ticker.endswith(suf):
            return m
    return "US"


class CoreContext:
    """Concrete BuildContext (pipeline/context.py)."""

    def __init__(self, cfg: dict[str, Any], market_map: dict[str, str], now_utc: pd.Timestamp):
        self.cfg = cfg
        self._market_map = market_map
        self._now = now_utc
        self._prices: dict[str, pd.DataFrame | None] = {}
        self._ret: dict[str, pd.Series | None] = {}
        self._aligned: dict[str, pd.Series | None] = {}
        self.india_dates: pd.DatetimeIndex = pd.DatetimeIndex([])
        self.window: tuple[pd.Timestamp, pd.Timestamp] = (pd.Timestamp("1970-01-01"), pd.Timestamp("1970-01-01"))
        self.targets: list[dict[str, Any]] = []
        self.origins: list[dict[str, Any]] = []
        self.securities: dict[str, dict[str, Any]] = {}
        self.usd_inr: float = float("nan")
        self.dropped_partial: list[str] = []

    # --- BuildContext API
    def market_of(self, ticker: str) -> str:
        return self._market_map.get(ticker) or infer_market(ticker)

    def prices(self, ticker: str) -> pd.DataFrame | None:
        if ticker not in self._prices:
            df = get_history(ticker)
            if df is not None and len(df) > 1:
                mk = self.cfg["markets"].get(self.market_of(ticker))
                if mk is not None:
                    close_ts = close_timestamps([df.index[-1]], mk)[0]
                    if self._now < close_ts + pd.Timedelta(minutes=20):
                        df = df.iloc[:-1]
                        self.dropped_partial.append(ticker)
            self._prices[ticker] = df
        return self._prices[ticker]

    def logret(self, ticker: str) -> pd.Series | None:
        if ticker not in self._ret:
            self._ret[ticker] = log_returns(self.prices(ticker))
        return self._ret[ticker]

    def aligned_to_india(self, ticker: str) -> pd.Series | None:
        if ticker not in self._aligned:
            r = self.logret(ticker)
            if r is None or not len(self.india_dates):
                self._aligned[ticker] = None
            else:
                mk = self.cfg["markets"][self.market_of(ticker)]
                x, _ = align_series(self.india_dates, self.cfg["markets"]["IN"], r, mk)
                self._aligned[ticker] = x
        return self._aligned[ticker]

    def source_ids(self) -> set[str]:
        return {s["id"] for s in self.cfg.get("sources", [])}


# ============================================================================ helpers
def _close(df: pd.DataFrame | None) -> pd.Series | None:
    if df is None or df.empty:
        return None
    return df["Close"].astype(float)


def _weekly(close: pd.Series | None, since: str = "2021-01-01") -> dict[str, Any] | None:
    if close is None:
        return None
    c = close.dropna()
    c = c[c.index >= pd.Timestamp(since)]
    if c.empty:
        return None
    w = c.groupby(c.index.to_period("W-FRI")).last()
    dates = c.groupby(c.index.to_period("W-FRI")).apply(lambda s: s.index[-1].strftime("%Y-%m-%d"))
    return {"dates": list(dates.to_numpy()), "close": [float(v) for v in w.to_numpy()]}


def _src_norm(s: dict[str, Any]) -> dict[str, Any]:
    def sd(x: Any) -> str | None:
        return None if x is None else str(x)

    return {
        "id": str(s["id"]),
        "title": str(s.get("title", s["id"])),
        "publisher": sd(s.get("publisher")),
        "url": str(s.get("url", "")),
        "date": sd(s.get("date")),
        "quote": sd(s.get("quote")),
        "verification": s.get("verification", "SECONDARY") if s.get("verification") in ("PRIMARY", "SECONDARY", "UNVERIFIED") else "SECONDARY",
        "accessed": sd(s.get("accessed")) or ACCESSED,
        "note": sd(s.get("note")),
    }


def _zero_share(label: str, why: str) -> dict[str, Any]:
    return {"label": label, "parts": [{"label": why, "value": 0.0, "status": "USER_ASSUMPTION"}]}


def _param(p: dict[str, Any], options_fill: dict[str, list[str]]) -> dict[str, Any]:
    kind = p.get("kind", "number")
    opts = p.get("options")
    if opts is None and kind in options_fill:
        opts = options_fill[kind]
    mc = p.get("mc")
    if isinstance(mc, dict):
        mc = {"dist": mc.get("dist", "fixed"), "low": fnum(mc.get("low")), "high": fnum(mc.get("high"))}
    else:
        mc = None
    val = p.get("value")
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        val = float(val)
    return {
        "key": p["key"],
        "label": p.get("label", p["key"]),
        "kind": kind,
        "value": val,
        "min": fnum(p.get("min")),
        "max": fnum(p.get("max")),
        "step": fnum(p.get("step")),
        "unit": p.get("unit"),
        "options": [str(o) for o in opts] if opts is not None else None,
        "status": p.get("status", "USER_ASSUMPTION"),
        "src": list(p.get("src", []) or []),
        "note": p.get("note"),
        "mc": mc,
    }


def _worst_windows(r: pd.Series | None) -> dict[str, Any]:
    if r is None or r.empty:
        return {"d1": 0.0, "d1_date": "", "d21": 0.0, "d21_end": "", "d252": 0.0, "d252_end": ""}
    r = r[r.index >= pd.Timestamp("1994-01-01")]
    r21 = r.rolling(21).sum()
    r252 = r.rolling(252).sum()
    return {
        "d1": float(r.min()), "d1_date": r.idxmin().strftime("%Y-%m-%d"),
        "d21": float(r21.min()), "d21_end": r21.idxmin().strftime("%Y-%m-%d"),
        "d252": float(r252.min()), "d252_end": r252.idxmin().strftime("%Y-%m-%d"),
    }


# ============================================================================ main build
def build(skip_fund: bool = False, only_prices: bool = False, out: Path = OUT, log=print) -> dict[str, Any]:
    t0 = time.time()
    now = pd.Timestamp(datetime.now(timezone.utc))
    cfg, cfg_log = load_universe()
    S = cfg["settings"]
    warnings: list[str] = [f"config: {m}" for m in cfg_log if m.startswith("overlay") or "not found" in m]
    for m in cfg_log:
        log(f"[config] {m}")

    # ---------------------------------------------------------------- ticker universe & markets
    market_map: dict[str, str] = {}
    for f in cfg["factors"]:
        market_map[f["ticker"]] = f.get("market") or infer_market(f["ticker"])
    for o in cfg["origins"]:
        market_map[o["ticker"]] = o.get("market", "US")
    for p in cfg.get("parents", []):
        market_map[p["ticker"]] = p.get("market") or infer_market(p["ticker"])
    for t in cfg["india"]:
        market_map[t["ticker"]] = t.get("market") or infer_market(t["ticker"])
    for c, spec in (cfg.get("fx_rates") or {}).items():
        if spec:
            market_map[spec["ticker"]] = "FX"
    adrs = list(cfg.get("benchmarks", {}).get("adrs", []))
    for a in adrs:
        market_map[a] = "US"
    ctx = CoreContext(cfg, market_map, now)

    requested = list(dict.fromkeys(list(market_map.keys())))
    ticker_log: list[dict[str, Any]] = []
    for fx_ in cfg.get("ticker_fixes", []) or []:
        ticker_log.append({"requested": fx_["requested"], "resolved": fx_.get("resolved"), "action": fx_.get("action", "fixed"),
                           "note": fx_.get("note", "")})
    for t in requested:
        df = ctx.prices(t)
        if df is None or df.empty:
            ticker_log.append({"requested": t, "resolved": None, "action": "dropped", "note": "no data from Yahoo Finance"})
            warnings.append(f"ticker {t} returned no data and was dropped")
        else:
            ticker_log.append({"requested": t, "resolved": t, "action": "ok",
                               "note": f"{len(df)} daily bars {df.index[0].date()}..{df.index[-1].date()}"})
    if ctx.dropped_partial:
        warnings.append("dropped an in-progress (not yet closed) session for: " + ", ".join(sorted(set(ctx.dropped_partial))))
    log(f"[prices] {len(requested)} tickers checked in {time.time()-t0:.1f}s")

    nifty_df = ctx.prices("^NSEI")
    if nifty_df is None:
        raise SystemExit("^NSEI unavailable: cannot build the India calendar")
    ctx.india_dates = pd.DatetimeIndex(nifty_df.index)
    as_of = ctx.india_dates[-1]
    ndx_df = ctx.prices("^NDX")
    as_of_us = ndx_df.index[-1] if ndx_df is not None else as_of
    years = int(S.get("regression_years", 3))
    wstart = ctx.india_dates[ctx.india_dates.searchsorted(as_of - pd.DateOffset(years=years))]
    ctx.window = (wstart, as_of)
    resid_dates = ctx.india_dates[(ctx.india_dates >= wstart) & (ctx.india_dates <= as_of)]

    # ---------------------------------------------------------------- FX conversion
    usd_per: dict[str, float] = {"USD": 1.0}
    for ccy, spec in (cfg.get("fx_rates") or {}).items():
        if not spec:
            continue
        c = _close(ctx.prices(spec["ticker"]))
        if c is None or c.dropna().empty:
            warnings.append(f"fx rate {ccy} unavailable")
            continue
        last = float(c.dropna().iloc[-1])
        usd_per[ccy] = (1.0 / last) if spec.get("quote") == "per_usd" else last
    usd_inr = 1.0 / usd_per["INR"]
    ctx.usd_inr = usd_inr
    for alias, base in (("GBp", None),):
        pass

    # ---------------------------------------------------------------- fundamentals
    fund: dict[str, dict[str, Any]] = {}
    fund_tickers = [o["ticker"] for o in cfg["origins"]] + [t["ticker"] for t in cfg["india"]] + \
        [p["ticker"] for p in cfg.get("parents", [])] + adrs
    tf = time.time()
    for t in fund_tickers:
        if only_prices:
            fund[t] = {}
        elif skip_fund:
            fund[t] = fetch_fund.load_cached(t)
        else:
            fund[t] = fetch_fund.get_all(t, max_age_days=float(S.get("fundamentals_cache_days", 3)),
                                         earnings_limit=int(S.get("earnings_dates_limit", 80)))
    log(f"[fund] {len(fund_tickers)} tickers in {time.time()-tf:.1f}s (skip_fund={skip_fund}, only_prices={only_prices})")

    # ---------------------------------------------------------------- securities
    names: dict[str, str] = {}
    roles: dict[str, str] = {}
    for f in cfg["factors"]:
        names[f["ticker"]] = f["name"]
        roles[f["ticker"]] = "factor" if f["id"] not in ("NIFTY", "NIFTYIT") else "benchmark"
    for o in cfg["origins"]:
        names[o["ticker"]], roles[o["ticker"]] = o["name"], "origin"
    for p in cfg.get("parents", []):
        names[p["ticker"]], roles[p["ticker"]] = p["name"], "parent"
    for t in cfg["india"]:
        names[t["ticker"]], roles[t["ticker"]] = t["name"], "india"
    for a in adrs:
        names[a] = {"INFY": "Infosys (NYSE ADR)", "WIT": "Wipro (NYSE ADR)"}.get(a, a)
        roles[a] = "adr"
    for ccy, spec in (cfg.get("fx_rates") or {}).items():
        if spec and spec["ticker"] not in names:
            names[spec["ticker"]] = f"FX {spec['ticker']}"
            roles[spec["ticker"]] = "fx"

    chatgpt = S["pre_chatgpt_date"]
    nifty_close = _close(nifty_df)
    ndx_close = _close(ndx_df)
    bench_ret = {"^NSEI": ret_since(nifty_close, chatgpt) if nifty_close is not None else None,
                 "^NDX": ret_since(ndx_close, chatgpt) if ndx_close is not None else None}
    securities: dict[str, dict[str, Any]] = {}
    extra: dict[str, dict[str, Any]] = {}
    for t in requested:
        df = ctx.prices(t)
        c = _close(df)
        mkt = ctx.market_of(t)
        role = roles.get(t, "history")
        fb = None
        if t in fund:
            mk = cfg["markets"].get(mkt if mkt in cfg["markets"] else "US")
            fb = compute_security_fundamentals(t, fund[t], c, mk["tz"], usd_per, S, MARKET_CCY.get(mkt))
        ccy = (fb or {}).get("currency") or MARKET_CCY.get(mkt) or ("INR" if t == "USDINR=X" else "USD")
        if t.endswith("=X"):
            ccy = "RATE"
        last_close = float(c.dropna().iloc[-1]) if c is not None and not c.dropna().empty else None
        chg = None
        if c is not None and len(c.dropna()) > 1:
            cc = c.dropna()
            chg = float(cc.iloc[-1] / cc.iloc[-2] - 1.0)
        mcap_local = (fb or {}).get("mcap_local")
        conv = usd_per.get(ccy)
        mcap_usd = mcap_local * conv if (mcap_local is not None and conv) else None
        bench = "^NSEI" if mkt == "IN" or role == "india" else ("^NDX" if role in ("origin", "parent", "adr") else None)
        rs = ret_since(c, chatgpt) if c is not None else None
        rs_vs = (rs - bench_ret[bench]) if (rs is not None and bench and bench_ret.get(bench) is not None) else None
        if fb is not None:
            ol = build_quantity(
                f"{t}.op_leverage",
                {"label": "Operating leverage (incremental / current EBIT margin)",
                 "parts": [{"label": fb["op_leverage_method"], "value": fb["op_leverage_value"],
                            "status": fb["op_leverage_status"]}]},
                unit="x", bounds=(1.0, 4.0, 0.1))
            ol["editable"] = True
        else:
            ol = computed_quantity(f"{t}.op_leverage", "Operating leverage (not applicable)", None, "x")
        notes = list((fb or {}).get("notes", []))
        securities[t] = {
            "ticker": t, "name": names.get(t, t), "role": role, "market": mkt if mkt in MARKET_CCY or mkt == "FX" else "OTHER",
            "currency": ccy, "last_close": last_close,
            "last_date": c.dropna().index[-1].strftime("%Y-%m-%d") if last_close is not None else None,
            "chg_1d": chg, "first_date": c.dropna().index[0].strftime("%Y-%m-%d") if last_close is not None else None,
            "shares": (fb or {}).get("shares"), "mcap_local": mcap_local, "mcap_usd": mcap_usd,
            "mcap_inr": mcap_usd * usd_inr if mcap_usd is not None else None,
            "pe_ttm": (fb or {}).get("pe_ttm"), "eps_ttm": (fb or {}).get("eps_ttm"), "pe_basis": (fb or {}).get("pe_basis"),
            "pe_pre_chatgpt_median": (fb or {}).get("pe_pre_chatgpt_median"),
            "pe_pre_chatgpt_n": (fb or {}).get("pe_pre_chatgpt_n"),
            "ai_premium": (fb or {}).get("ai_premium"),
            "ret_since_chatgpt": rs, "ret_since_chatgpt_vs_bench": rs_vs, "bench": bench,
            "revenue_ttm": (fb or {}).get("revenue_ttm"), "ebit_margin": (fb or {}).get("ebit_margin"),
            "gross_margin": (fb or {}).get("gross_margin"), "op_leverage": ol,
            "data_ok": last_close is not None, "notes": notes,
            "price_history": _weekly(c),
            # additive optional fields (documented in the status report)
            "revenue_ttm_usd": (fb or {}).get("revenue_ttm_usd"),
            "financial_currency": (fb or {}).get("financial_currency"),
        }
        extra[t] = fb or {}
    ctx.securities = securities

    # ---------------------------------------------------------------- origins & basket weights
    mc = {o["ticker"]: securities.get(o["ticker"], {}).get("mcap_usd") for o in cfg["origins"]}
    chips = [o["ticker"] for o in cfg["origins"] if o["group"] == "chips"]
    if any(mc[t] is None for t in mc):
        warnings.append("basket weights: market cap missing for " + ", ".join(t for t in mc if mc[t] is None)
                        + " (equal weight within the basket used for those names)")

    def weights(names_: list[str]) -> dict[str, float]:
        vals = {t: mc[t] for t in names_ if mc.get(t)}
        if not vals:
            return {t: 1.0 / len(names_) for t in names_}
        avg = float(np.mean(list(vals.values())))
        raw = {t: (mc[t] if mc.get(t) else avg) for t in names_}
        tot = sum(raw.values())
        return {t: v / tot for t, v in raw.items()}

    w_chip = weights(chips)
    w_ai = weights([o["ticker"] for o in cfg["origins"]])

    origins_out = []
    for o in cfg["origins"]:
        t = o["ticker"]
        fb = extra.get(t, {})
        hs_spec = o.get("hyperscaler_share") or _zero_share(
            "Share of revenue from hyperscaler capex",
            "capex spender / not an AI-capex supplier (definitional zero)" if o["group"] == "hyperscalers" else "not an AI-capex supplier (definitional zero)")
        nc_spec = o.get("neocloud_share") or _zero_share("Share of revenue from AI clouds / neoclouds", "not modelled as a neocloud supplier (zero)")
        nd = fb.get("net_debt_usd")
        eb = fb.get("ebitda_ttm_usd")
        origins_out.append({
            "ticker": t, "group": o["group"],
            "in_chip_basket": o["group"] == "chips", "in_ai_basket": True,
            "weight_chip_basket": w_chip.get(t, 0.0), "weight_ai_basket": w_ai.get(t, 0.0),
            "hyperscaler_share": build_quantity(f"{t}.hyperscaler_share", hs_spec, "frac"),
            "neocloud_share": build_quantity(f"{t}.neocloud_share", nc_spec, "frac"),
            "capex_ttm_usd": fb.get("capex_ttm_usd") if o.get("capex_spender") else None,
            "capex_quarters": fb.get("capex_quarters", []) if o.get("capex_spender") else [],
            "credit": {"stressed": bool((o.get("credit") or {}).get("stressed", False)), "net_debt_usd": nd,
                       "ebitda_ttm_usd": eb, "nd_ebitda": (nd / eb) if (nd is not None and eb and eb > 0) else None},
            "concentration": [{"text": c_["text"], "status": c_.get("status", "SOURCED"), "src": list(c_.get("src", []))}
                              for c_ in (o.get("concentration") or [])],
        })
    ctx.origins = [{"ticker": o["ticker"], "name": o["name"], "group": o["group"], "market": "US"} for o in cfg["origins"]]
    ctx.targets = [{"ticker": t["ticker"], "display": t.get("display", t["ticker"]), "name": t["name"], "tier": t["tier"],
                    "parent": t.get("parent"), "market": ctx.market_of(t["ticker"])} for t in cfg["india"]]

    # ---------------------------------------------------------------- Layer-2 estimation
    te = time.time()
    est = model.Estimator(cfg, ctx.logret, ctx.market_of, ctx.window, ctx.india_dates)
    nm = model.nifty_model(est)
    if nm["main"] is None:
        raise SystemExit("Nifty model failed")
    frames: dict[str, pd.DataFrame | None] = {}
    india_out = []
    n_india = len(resid_dates)
    rd_index = pd.DatetimeIndex(resid_dates)
    for t in cfg["india"]:
        tk = t["ticker"]
        res = model.target_model(est, tk, t.get("parent"), nm)
        frames[tk] = res["frame"]
        resid = res["resid"]
        resid_list = resid.reindex(rd_index).tolist() if resid is not None else [None] * n_india
        sec = securities.get(tk, {})
        first = pd.Timestamp(sec["first_date"]) if sec.get("first_date") else None
        short = bool(first is None or first > ctx.window[0] + pd.Timedelta(days=30))
        notes = list(t.get("notes", []) or [])
        if res["reg"] is None:
            notes.append("regression not estimable (insufficient overlapping data)")
        if short and first is not None:
            notes.append(f"short history: data from {first.date()} (window starts {ctx.window[0].date()})")
        hfcl_rev = extra.get(tk, {}).get("revenue_ttm")

        def inv_rev_cr(rev=hfcl_rev, cur=securities.get(tk, {}).get("currency")):
            if rev is None or rev <= 0:
                return None
            rev_inr = rev if (extra.get(tk, {}).get("financial_currency") or cur) == "INR" else None
            if rev_inr is None:
                return None
            return 1.0 / (rev_inr / float(S.get("inr_crore", 1e7)))

        resolvers = {"inv_revenue_ttm_cr": inv_rev_cr}
        exposures = []
        for ex in t.get("exposures", []) or []:
            q = build_quantity(f"{tk}.exposure.{ex['channel']}", ex["share"], "frac", resolvers=resolvers)
            if q is not None and q["value"] is not None and q["value"] > 1:
                notes.append(f"exposure {ex['channel']} computed {q['value']:.3f} > 1, capped at 1")
                q["value"] = 1.0
            exposures.append({"channel": ex["channel"], "share": q, "driver": ex.get("driver")})
        fxq = build_quantity(f"{tk}.fx_margin_sens_bps", t.get("fx_margin_sens_bps") or
                             {"label": "EBIT margin sensitivity to INR (bps per 1%)",
                              "parts": [{"label": "Not modelled", "value": 0, "status": "USER_ASSUMPTION"}]}, "bps")
        stake = build_quantity(f"{tk}.parent_stake", t.get("parent_stake"), "frac") if t.get("parent_stake") else None
        entry = {
            "ticker": tk, "display": t.get("display", tk), "name": t["name"], "tier": t["tier"],
            "parent": t.get("parent"), "parent_secondary": t.get("parent_secondary"), "parent_stake": stake,
            "adr": t.get("adr"), "exposures": exposures, "fx_margin_sens_bps": fxq,
            "reg": stats.public(res["reg"]), "reg_down": stats.public(res["reg_down"]), "slopes": res["slopes"],
            "beta_total": res["beta_total"], "beta_total_down": res["beta_total_down"], "rolling": res["rolling"],
            "resid": resid_list, "short_history": short, "notes": notes,
        }
        # secondary parent (e.g. ENRIN on SIE.DE) reported alongside
        if t.get("parent_secondary"):
            alt = model.target_model(est, tk, t["parent_secondary"], nm)
            entry["reg_parent_secondary"] = stats.public(alt["reg"])
            if alt["reg"] is not None and "PARENT" in alt["reg"]["coef"]:
                c_ = alt["reg"]["coef"]["PARENT"]
                notes.append(f"secondary parent {t['parent_secondary']}: b_P={c_['b']:.3f} (HAC t {c_['t']:.2f}), R2={alt['reg']['r2']:.3f}")
        # ADR cross-check (US-listed: factors enter same-day)
        if t.get("adr") and ctx.prices(t["adr"]) is not None:
            adr_res = model.target_model(est, t["adr"], None, nm)
            if adr_res["reg"] is not None:
                entry["adr_reg"] = stats.public(adr_res["reg"])
                cc = adr_res["reg"]["coef"]
                notes.append(f"ADR cross-check {t['adr']} (same-day US factors): b_SOX={cc['SOX']['b']:.3f}, b_NDX={cc['NDX']['b']:.3f}, "
                             f"b_N={cc['NIFTY']['b']:.3f}, R2={adr_res['reg']['r2']:.3f}, beta_total={adr_res['beta_total']:.3f}" if adr_res['beta_total'] is not None else "")
        india_out.append(entry)
    log(f"[model] {len(india_out)} India regressions in {time.time()-te:.1f}s")

    origin_tickers = [o["ticker"] for o in cfg["origins"]]
    target_tickers = [t["ticker"] for t in cfg["india"]]
    th = time.time()
    cells = model.heatmap(est, target_tickers, origin_tickers, frames)
    log(f"[model] heatmap {len(target_tickers)}x{len(origin_tickers)} in {time.time()-th:.1f}s")

    us_start = ctx.window[0]
    peer_o = model.peer_betas({t: ctx.logret(t) for t in origin_tickers}, us_start, as_of_us)
    peer_i = model.peer_betas({t: ctx.logret(t) for t in target_tickers}, us_start, as_of)

    def simple(t: str) -> pd.Series | None:
        df = ctx.prices(t)
        return None if df is None else df["AdjClose"].astype(float).pct_change()

    sox_map = model.basket_map(ctx.logret("^SOX"), {t: simple(t) for t in chips}, w_chip, us_start, as_of_us)
    ndx_map = model.basket_map(ctx.logret("^NDX"), {t: simple(t) for t in origin_tickers}, w_ai, us_start, as_of_us)
    xw = est.in_window(nm["frame"])
    r_ns = stats.ols(xw["NDX"], xw[["SOX"]], int(S.get("hac_lags", 5)), "x_NDX on x_SOX")
    ndx_on_sox = {"beta": r_ns["coef"]["SOX"]["b"], "r2": r_ns["r2"], "n": r_ns["n"]} if r_ns else {"beta": 1.0, "r2": 0.0, "n": 0}

    parents_needed = sorted({t.get("parent") for t in cfg["india"] if t.get("parent")} |
                            {t.get("parent_secondary") for t in cfg["india"] if t.get("parent_secondary")})
    parent_maps = {}
    for p in parents_needed:
        pm = model.parent_map(est, p)
        if pm is not None:
            parent_maps[p] = pm
        else:
            warnings.append(f"parent map for {p} not estimable")

    fxc = fxmod.fx_calibration(est, {k: _close(ctx.prices(k)) for k in ("USDINR=X", "^NDX", "^SOX", "^NSEI")},
                               cfg.get("fx_episodes", []))
    fx_close = _close(ctx.prices("USDINR=X"))
    fx_block = {
        "spot": float(fx_close.dropna().iloc[-1]), "spot_date": fx_close.dropna().index[-1].strftime("%Y-%m-%d"),
        "beta_inr_on_ndx": fxc["beta_inr_on_ndx"], "beta_inr_on_ndx_down": fxc["beta_inr_on_ndx_down"],
        "r2": fxc["r2"], "n": fxc["n"], "episodes": fxc["episodes"], "default_f": fxc["default_f"],
    }

    # ---------------------------------------------------------------- calibration
    calib = calibration.contagion_fallback(ctx.logret)
    calib["tier_median_premium"] = calibration.tier_median_premium(cfg["india"], securities)

    # ---------------------------------------------------------------- history (guarded)
    worst = {"SOX": _worst_windows(ctx.logret("^SOX")), "NDX": _worst_windows(ctx.logret("^NDX"))}
    replay_core = []
    series_for_replay = {"SOX": "^SOX", "NDX": "^NDX", "SPX": "^GSPC", "IXIC": "^IXIC", "NIFTY": "^NSEI",
                         "SENSEX": "^BSESN", "NIFTYIT": "^CNXIT"}
    for w in cfg.get("replay_windows", []) or []:
        moves = {k: fxmod.window_move(_close(ctx.prices(v)), w["start"], w["end"]) for k, v in series_for_replay.items()}
        replay_core.append({"id": w["id"], "label": w["label"], "start": str(w["start"]), "end": str(w["end"]),
                            "moves": moves, "status": "COMPUTED", "src": list(w.get("src", []) or []),
                            "note": "window boundaries are definitional; moves are log changes computed from Yahoo closes"})
    num_now = den_now = num_pre = den_pre = 0.0
    for o in cfg["origins"]:
        s_ = securities.get(o["ticker"], {})
        m_, pe_, pre_ = s_.get("mcap_usd"), s_.get("pe_ttm"), s_.get("pe_pre_chatgpt_median")
        if m_ and pe_ and pe_ > 0:
            num_now += m_
            den_now += m_ / pe_
        if m_ and pre_ and pre_ > 0:
            num_pre += m_
            den_pre += m_ / pre_
    history: dict[str, Any] = {
        "cases": [], "event_studies": [], "us_vs_india": [], "pe_vs_drawdown": [],
        "pe_fit": {"slope": 0.0, "intercept": 0.0, "r2": 0.0, "n": 0},
        "ai_basket_pe": {"now": num_now / den_now if den_now else None, "pre_chatgpt_median": num_pre / den_pre if den_pre else None,
                         "implied_drawdown": None},
        "overlay": [], "worst_windows": worst, "replay_windows": replay_core, "deepseek_next_day": [],
    }
    extra_sources: list[dict[str, Any]] = []
    if (ROOT / "pipeline" / "history.py").exists():
        tht = time.time()
        try:
            from pipeline.history import build_history  # noqa: WPS433 - optional module

            h_sec, h_cal, extra_sources = build_history(ctx)
            for k, v in (h_sec or {}).items():
                if v is None or (isinstance(v, (list, dict)) and len(v) == 0):
                    continue
                history[k] = v
            for k in ("contagion_us", "contagion_india"):
                q = (h_cal or {}).get(k)
                if isinstance(q, dict) and q.get("value") is not None:
                    calib[k] = q
            log(f"[history] build_history ok in {time.time()-tht:.1f}s")
        except Exception as exc:  # noqa: BLE001 - never block the core bundle
            warnings.append(f"history module failed: {type(exc).__name__}: {exc}")
            log("[history] FAILED\n" + traceback.format_exc())
    else:
        warnings.append("pipeline/history.py not present: history section contains core fallbacks only")

    # ---------------------------------------------------------------- presets / assumptions / sources
    replay_ids = [w["id"] for w in cfg.get("replay_windows", []) or []]
    fill = {"window": replay_ids, "ticker": origin_tickers + target_tickers}
    presets_out = []
    for p in cfg["presets"]:
        hov = p.get("horizon_overrides")
        if hov:
            hov = {str(h): {k: {"value": v.get("value"), "low": fnum(v.get("low")), "high": fnum(v.get("high"))}
                            for k, v in d.items()} for h, d in hov.items()}
        presets_out.append({
            "id": p["id"], "num": int(p["num"]), "label": p["label"], "description": p.get("description", ""),
            "low_confidence": bool(p.get("low_confidence", False)),
            "params": [_param(x, fill) for x in p["params"]], "horizon_overrides": hov or None,
        })
    assumptions_out = []
    for a in cfg.get("assumptions", []) or []:
        q = build_quantity(a["id"], {"label": a["label"], "parts": [{"label": a["label"], "value": a.get("value", 0),
                                                                    "status": a.get("status", "USER_ASSUMPTION"),
                                                                    "src": a.get("src", []), "note": a.get("note")}],
                                     "note": a.get("note")},
                           a.get("unit", "x"), bounds=(fnum(a.get("min")), fnum(a.get("max")), fnum(a.get("step"))))
        assumptions_out.append(q)

    sources = [_src_norm(s) for s in cfg.get("sources", [])]
    seen = {s["id"] for s in sources}
    for s in extra_sources or []:
        ns = _src_norm(s)
        if ns["id"] not in seen:
            sources.append(ns)
            seen.add(ns["id"])

    tape = [f["ticker"] for f in cfg["factors"]] + origin_tickers + [p["ticker"] for p in cfg.get("parents", [])] + \
        target_tickers + adrs
    tape = [t for t in dict.fromkeys(tape) if securities.get(t, {}).get("data_ok")]

    settings_out = {k: v for k, v in S.items() if isinstance(v, (int, float, str, bool))}
    pre_end = pd.Timestamp(chatgpt)
    bundle = {
        "meta": {
            "app": S.get("app", "AI CRASH MONITOR"), "schema_version": SCHEMA_VERSION,
            "built_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "as_of": as_of.strftime("%Y-%m-%d"), "as_of_us": pd.Timestamp(as_of_us).strftime("%Y-%m-%d"),
            "usd_inr": usd_inr, "fx_rates_usd": usd_per,
            "regression_window": {"start": ctx.window[0].strftime("%Y-%m-%d"), "end": as_of.strftime("%Y-%m-%d"),
                                  "years": years, "n_india_days": int(n_india)},
            "pre_chatgpt": {"date": str(chatgpt),
                            "window_start": (pre_end - pd.DateOffset(years=int(S.get("pre_chatgpt_window_years", 3)))).strftime("%Y-%m-%d"),
                            "window_end": (pre_end - pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                            "src": list(S.get("pre_chatgpt_src", []))},
            "data_sources": [
                {"name": "Yahoo Finance via yfinance", "url": "https://finance.yahoo.com",
                 "note": "daily prices (split-adjusted Close for P/E, split+dividend AdjClose for returns), market caps, statements, earnings calendar; fetched "
                         + now.strftime("%Y-%m-%d")},
                {"name": "Company filings (via Yahoo statements)", "url": "https://www.sec.gov/edgar/search/",
                 "note": "capex, revenue, operating income, debt and cash are Yahoo's standardisation of reported filings"},
                {"name": "Robert Shiller online data (ie_data.xls)", "url": "http://www.econ.yale.edu/~shiller/data/ie_data.xls",
                 "note": "S&P composite prices, earnings and CAPE for the P/E-vs-drawdown scatter (history module)"},
            ],
            "ticker_log": ticker_log, "warnings": warnings,
            "alignment": {
                "rule": "Information-set rule: a foreign return enters India day t if its close falls in (NSE close of the previous India day, NSE close of t]; "
                        "US/Europe closes therefore enter with a 1-day lag, Tokyo same-day; foreign holidays give 0, India holidays accumulate.",
                "us_holiday_zero_days": int(est.diag.get("zero_days", 0)),
                "india_holiday_accumulations": int(est.diag.get("accumulated_days", 0)),
            },
        },
        "settings": settings_out,
        "sources": sources,
        "securities": securities,
        "tape": tape,
        "origins": origins_out,
        "india": india_out,
        "benchmarks": {"nifty": cfg["benchmarks"]["nifty"], "nifty_it": cfg["benchmarks"]["nifty_it"], "adrs": adrs},
        "nifty_model": stats.public(nm["main"]),
        "nifty_resid": nm["main"]["_resid"].reindex(rd_index).tolist(),
        "resid_dates": [d.strftime("%Y-%m-%d") for d in resid_dates],
        "factor_map": {"sox_on_chip_basket": sox_map, "ndx_on_ai_basket": ndx_map, "ndx_on_sox": ndx_on_sox},
        "parent_maps": parent_maps,
        "peer_beta": {"origins": peer_o, "india": peer_i},
        "heatmap": {"targets": target_tickers, "origins": origin_tickers, "cells": cells},
        "fx": fx_block,
        "calibration": calib,
        "assumptions": assumptions_out,
        "presets": presets_out,
        "history": history,
    }
    if nm.get("down") is not None:
        bundle["nifty_model_down"] = stats.public(nm["down"])  # additive optional field
    clean = sanitize(bundle)
    errs = validate_bundle(clean)
    if errs:
        log(f"[validate] {len(errs)} problem(s):")
        for e in errs[:60]:
            log("   - " + e)
        clean["meta"]["warnings"].append(f"schema validation reported {len(errs)} problem(s); first: {errs[0]}")
    else:
        log("[validate] OK — bundle matches src/types/data.ts")
    size = write_json(clean, out)
    log(f"[write] {out} ({size/1e6:.2f} MB) in {time.time()-t0:.1f}s total")
    return clean
