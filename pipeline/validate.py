"""Structural validator for public/data.json against src/types/data.ts (Python mirror of the TS types).

Usage: python -m pipeline.validate [path]   (exit code 1 on any error)
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------- tiny schema DSL
NUM, NUMN, STR, STRN, BOOL, ANY = "num", "num?", "str", "str?", "bool", "any"


def L(t: Any) -> tuple:  # list of t
    return ("list", t)


def LN(t: Any) -> tuple:  # list of t, or null
    return ("list?", t)


def D(t: Any) -> tuple:  # Record<string, t>
    return ("dict", t)


def E(*vals: Any) -> tuple:  # enum
    return ("enum", vals)


def EN(*vals: Any) -> tuple:  # enum or null
    return ("enum?", vals)


def O(**fields: Any) -> tuple:  # object
    return ("obj", fields)


def ON(**fields: Any) -> tuple:  # object or null
    return ("obj?", fields)


def U(*types: Any) -> tuple:  # union
    return ("union", types)


class Opt:
    """Optional key wrapper."""

    def __init__(self, t: Any):
        self.t = t


STATUS = E("SOURCED", "UNVERIFIED", "USER_ASSUMPTION", "COMPUTED", "DERIVED")
PART_STATUS = E("SOURCED", "UNVERIFIED", "USER_ASSUMPTION", "COMPUTED")
TIER = E("A", "B", "C", "D")
CRASH = E("earnings_collapse", "multiple_compression", "fraud_trust", "credit_liquidity", "capex_overbuild")
MARKET = E("US", "IN", "JP", "DE", "CH", "FR", "TW", "NL", "FX", "OTHER")

SOURCE = O(id=STR, title=STR, publisher=STRN, url=STR, date=STRN, quote=STRN,
           verification=E("PRIMARY", "SECONDARY", "UNVERIFIED"), accessed=STR, note=STRN)
PART = O(label=STR, value=NUM, status=PART_STATUS, src=L(STR), note=STRN)
QUANTITY = O(id=STR, label=STR, value=NUMN, unit=STR, status=STATUS, parts=L(PART), src=L(STR), note=STRN,
             editable=BOOL, min=NUMN, max=NUMN, step=NUMN)
QUANTITYN = ("nullable", QUANTITY)
COEF = O(b=NUM, se=NUM, t=NUM, p=NUM)
REG = O(spec=STR, n=NUM, start=STR, end=STR, coef=D(COEF), r2=NUM, adj_r2=NUM, resid_sd=NUM)
REGN = ("nullable", REG)
SECURITY = O(
    ticker=STR, name=STR, role=E("origin", "india", "parent", "factor", "benchmark", "adr", "history", "fx"),
    market=MARKET, currency=STR, last_close=NUMN, last_date=STRN, chg_1d=NUMN, first_date=STRN, shares=NUMN,
    mcap_local=NUMN, mcap_usd=NUMN, mcap_inr=NUMN, pe_ttm=NUMN, eps_ttm=NUMN,
    pe_basis=EN("calendar_reported", "yahoo_trailing"), pe_pre_chatgpt_median=NUMN, pe_pre_chatgpt_n=NUMN,
    ai_premium=NUMN, ret_since_chatgpt=NUMN, ret_since_chatgpt_vs_bench=NUMN, bench=STRN, revenue_ttm=NUMN,
    ebit_margin=NUMN, gross_margin=NUMN, op_leverage=QUANTITY, data_ok=BOOL, notes=L(STR),
    price_history=Opt(("nullable", O(dates=L(STR), close=L(NUM)))),
)
ORIGIN = O(
    ticker=STR, group=E("chips", "hyperscalers", "infra", "software"), in_chip_basket=BOOL, in_ai_basket=BOOL,
    weight_chip_basket=NUM, weight_ai_basket=NUM, hyperscaler_share=QUANTITY, neocloud_share=QUANTITY,
    capex_ttm_usd=NUMN, capex_quarters=L(O(period=STR, value_usd=NUM)),
    credit=O(stressed=BOOL, net_debt_usd=NUMN, ebitda_ttm_usd=NUMN, nd_ebitda=NUMN),
    concentration=L(O(text=STR, status=STATUS, src=L(STR))),
)
EXPOSURE = O(channel=E("revenue", "capex", "credit"), share=QUANTITY, driver=STRN)
ROLLING = O(dates=L(STR), SOX=L(NUMN), NDX=L(NUMN), PARENT=LN(NUMN), NIFTY=L(NUMN), r2=L(NUMN))
INDIA = O(
    ticker=STR, display=STR, name=STR, tier=TIER, parent=STRN, parent_secondary=STRN, parent_stake=QUANTITYN,
    adr=STRN, exposures=L(EXPOSURE), fx_margin_sens_bps=QUANTITY, reg=REGN, reg_down=REGN,
    slopes=O(ndx_on_sox=NUMN, parent_on_sox=NUMN, ndx_on_sox_down=NUMN, parent_on_sox_down=NUMN),
    beta_total=NUMN, beta_total_down=NUMN, rolling=("nullable", ROLLING), resid=L(NUMN), short_history=BOOL,
    notes=L(STR),
)
HEAT = O(beta=NUMN, t=NUMN, corr=NUMN)
FXEP = O(id=STR, label=STR, start=STR, end=STR, inr_depr=NUMN, ndx=NUMN, sox=NUMN, nifty=NUMN)
PVAL = U(NUM, STR, BOOL, "null")
PARAM = O(key=STR, label=STR, kind=E("number", "ticker", "enum", "bool", "window"), value=PVAL, min=NUMN, max=NUMN,
          step=NUMN, unit=STRN, options=LN(STR), status=STATUS, src=L(STR), note=STRN,
          mc=("nullable", O(dist=E("triangular", "uniform", "fixed"), low=NUMN, high=NUMN)))
PRESET = O(id=E("capex", "guidance", "restatement", "multiple", "credit", "replay", "fullpop"), num=NUM, label=STR,
           description=STR, low_confidence=BOOL, params=L(PARAM), horizon_overrides=("nullable", D(D(ANY))))
REPLAY = O(id=STR, label=STR, start=STR, end=STR, moves=D(NUMN), status=STATUS, src=L(STR), note=STRN)
DRAWDOWN = O(label=STR, ticker=STRN, peak_date=STRN, peak=NUMN, trough_date=STRN, trough=NUMN, drawdown=NUMN,
             days_to_bottom=NUMN, days_to_recover=NUMN, recovered_date=STRN, status=STATUS, src=L(STR), note=STRN)
CASE = O(id=STR, name=STR, period=STR, what_broke=STR, crash_types=L(CRASH), drawdowns=L(DRAWDOWN), linked=STR,
         india=STR, src=L(STR), notes=L(STR))
MEMBER = O(ticker=STR, label=STR, tier=EN("A", "B", "C", "D"), car=L(NUMN), ar0=NUMN, ar1=NUMN, car_end=NUMN,
           method=E("market_model", "market_adjusted"))
STUDY = O(id=STR, label=STR, date=STR, crash_types=L(CRASH), window=L(NUM),
          groups=L(O(name=STR, index=STR, members=L(MEMBER), mean_car=L(NUMN))), src=L(STR), note=STRN)
USIN = O(date=STR, us_date=STRN, event=STRN, x_sox=NUM, ticker=STR, tier=TIER, r=NUM)
PEPT = O(id=STR, label=STR, market=STR, peak_date=STRN, pe=NUM, pe_kind=E("CAPE", "trailing"), pe_status=STATUS,
         drawdown=NUM, drawdown_status=STATUS, src=L(STR), note=STRN)
OVERLAY = O(label=STR, ticker=STR, peak_date=STR, t=L(NUM), v=L(NUM))
WORST = O(d1=NUM, d1_date=STR, d21=NUM, d21_end=STR, d252=NUM, d252_end=STR)
HISTORY = O(
    cases=L(CASE), event_studies=L(STUDY), us_vs_india=L(USIN), pe_vs_drawdown=L(PEPT),
    pe_fit=O(slope=NUM, intercept=NUM, r2=NUM, n=NUM),
    ai_basket_pe=O(now=NUMN, pre_chatgpt_median=NUMN, implied_drawdown=NUMN),
    overlay=L(OVERLAY), worst_windows=O(SOX=WORST, NDX=WORST), replay_windows=L(REPLAY),
    deepseek_next_day=L(O(ticker=STR, tier=EN("A", "B", "C", "D"), r_jan27=NUMN, r_jan28=NUMN, ar_jan28=NUMN)),
)
# ---------------------------------------------------------------------------- V2 accuracy lab (all optional)
H_ENUM = E(1, 5, 21)
MODEL_SPEC = O(id=STR, label=STR, description=STR, family=E("baseline", "linear", "robust", "nonlinear", "stack"),
               mode=E("scenario", "nowcast"), scenario_usable=BOOL, features=L(STR))
FACTOR_AUX = O(id=STR, ticker=STR, name=STR, market=MARKET, role=STR, scenario_map=ON(SOX=NUM, NDX=NUM, r2=NUM, n=NUM))
HORIZON = O(h=H_ENUM, SOX=NUM, NDX=NUM, PARENT=NUMN, NIFTY=NUM, beta_total=NUMN, r2_oos=NUMN, n_oos=NUM)
OOS = O(rmse=NUM, mae=NUM, r2=NUM, hit=NUMN, n=NUM)
STOCK_MODELS = O(ticker=STR, horizons=L(HORIZON),
                 components=D(O(SOX=NUM, NDX=NUM, PARENT=NUMN, NIFTY=NUM, weight=NUM)),
                 oos=D(OOS), oos_shock=D(OOS), oos_nowcast=("nullable", D(OOS)), oos_resid=L(NUMN), coverage90=NUMN)
EVENT_ROW = O(ticker=STR, display=STR, tier=TIER, actual=NUM, pred=D(NUMN), lo90=NUMN, hi90=NUMN)
BT_EVENT = O(id=STR, label=STR, us_date=STRN, india_date=STR, kind=E("named", "worst_sox"), x_sox=NUM, x_ndx=NUM,
             rows=L(EVENT_ROW), metrics=D(O(corr=NUMN, mae=NUM, hit=NUMN)))
BACKTEST = O(method=STR, start=STR, end=STR, refit_every=NUM, train_years=NUM, dates=L(STR), models=L(MODEL_SPEC),
             ensemble=O(method=STR, weights=D(NUM), weights_by_tier=Opt(D(D(NUM)))),
             summary=L(O(mode=E("scenario", "nowcast"), subset=E("all", "shock", "events"), model=STR, rmse=NUM, mae=NUM,
                         r2=NUM, hit=NUMN, corr_xs=NUMN, n=NUM)),
             calibration=L(O(nominal=NUM, coverage=NUM, n=NUM)), events=L(BT_EVENT),
             horizon_check=L(O(h=H_ENUM, model=STR, r2=NUM, n=NUM)),
             nifty_horizons=L(O(h=H_ENUM, SOX=NUM, NDX=NUM, r2=NUM, n=NUM)), nifty_oos_resid=Opt(L(NUMN)))
NOWCAST = ON(us_date=STR, for_india_date=STR, note=STR,
             rows=L(O(ticker=STR, display=STR, pred=NUM, lo90=NUMN, hi90=NUMN, actual=Opt(NUMN))),
             nifty=ON(pred=NUM, lo90=NUMN, hi90=NUMN, actual=Opt(NUMN)))

BUNDLE = O(
    meta=O(app=STR, schema_version=NUM, built_at=STR, as_of=STR, as_of_us=STR, usd_inr=NUM, fx_rates_usd=D(NUM),
           regression_window=O(start=STR, end=STR, years=NUM, n_india_days=NUM),
           pre_chatgpt=O(date=STR, window_start=STR, window_end=STR, src=L(STR)),
           data_sources=L(O(name=STR, url=STR, note=STR)),
           ticker_log=L(O(requested=STR, resolved=STRN, action=E("ok", "fixed", "dropped", "warning"), note=STR)),
           warnings=L(STR), alignment=O(rule=STR, us_holiday_zero_days=NUM, india_holiday_accumulations=NUM)),
    settings=D(U(NUM, STR, BOOL)),
    sources=L(SOURCE),
    securities=D(SECURITY),
    tape=L(STR),
    origins=L(ORIGIN),
    india=L(INDIA),
    benchmarks=O(nifty=STR, nifty_it=STR, adrs=L(STR)),
    nifty_model=REG,
    nifty_resid=L(NUMN),
    resid_dates=L(STR),
    factor_map=O(sox_on_chip_basket=O(beta=NUM, r2=NUM, n=NUM), ndx_on_ai_basket=O(beta=NUM, r2=NUM, n=NUM),
                 ndx_on_sox=O(beta=NUM, r2=NUM, n=NUM)),
    parent_maps=D(O(SOX=NUM, NDX=NUM, r2=NUM, n=NUM, method=STR)),
    peer_beta=O(origins=D(D(NUM)), india=D(D(NUM))),
    heatmap=O(targets=L(STR), origins=L(STR), cells=L(L(HEAT))),
    fx=O(spot=NUM, spot_date=STR, beta_inr_on_ndx=NUM, beta_inr_on_ndx_down=NUMN, r2=NUM, n=NUM,
         episodes=L(FXEP), default_f=QUANTITY),
    calibration=O(contagion_us=QUANTITY, contagion_india=QUANTITY, tier_median_premium=O(A=NUMN, B=NUMN, C=NUMN, D=NUMN)),
    assumptions=L(QUANTITY),
    presets=L(PRESET),
    history=HISTORY,
    factors_aux=Opt(L(FACTOR_AUX)),
    models=Opt(L(STOCK_MODELS)),
    backtest=Opt(BACKTEST),
    nowcast=Opt(NOWCAST),
)


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))


def check(v: Any, spec: Any, path: str, errs: list[str]) -> None:
    if len(errs) > 200:
        return
    if isinstance(spec, Opt):
        spec = spec.t
    if spec == ANY:
        return
    if spec == "null":
        if v is not None:
            errs.append(f"{path}: expected null")
        return
    if spec == NUM:
        if not _is_num(v):
            errs.append(f"{path}: expected number, got {type(v).__name__}:{str(v)[:40]}")
        return
    if spec == NUMN:
        if v is not None and not _is_num(v):
            errs.append(f"{path}: expected number|null, got {type(v).__name__}:{str(v)[:40]}")
        return
    if spec == STR:
        if not isinstance(v, str):
            errs.append(f"{path}: expected string, got {type(v).__name__}")
        return
    if spec == STRN:
        if v is not None and not isinstance(v, str):
            errs.append(f"{path}: expected string|null, got {type(v).__name__}")
        return
    if spec == BOOL:
        if not isinstance(v, bool):
            errs.append(f"{path}: expected boolean")
        return
    kind = spec[0]
    if kind == "nullable":
        if v is not None:
            check(v, spec[1], path, errs)
        return
    if kind in ("list", "list?"):
        if v is None and kind == "list?":
            return
        if not isinstance(v, list):
            errs.append(f"{path}: expected array")
            return
        for i, x in enumerate(v):
            check(x, spec[1], f"{path}[{i}]", errs)
        return
    if kind == "dict":
        if not isinstance(v, dict):
            errs.append(f"{path}: expected object/record")
            return
        for k, x in v.items():
            check(x, spec[1], f"{path}.{k}", errs)
        return
    if kind in ("enum", "enum?"):
        if v is None and kind == "enum?":
            return
        if v not in spec[1]:
            errs.append(f"{path}: {v!r} not in {spec[1]}")
        return
    if kind == "union":
        for t in spec[1]:
            sub: list[str] = []
            check(v, t, path, sub)
            if not sub:
                return
        errs.append(f"{path}: value {str(v)[:40]} matches no union member")
        return
    if kind in ("obj", "obj?"):
        if v is None and kind == "obj?":
            return
        if not isinstance(v, dict):
            errs.append(f"{path}: expected object")
            return
        for k, t in spec[1].items():
            if k not in v:
                if isinstance(t, Opt):
                    continue
                errs.append(f"{path}: missing key '{k}'")
                continue
            check(v[k], t, f"{path}.{k}", errs)
        return
    raise ValueError(f"bad spec at {path}: {spec}")


def cross_checks(b: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    src_ids = {s["id"] for s in b.get("sources", [])}

    def walk(o: Any, p: str) -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "src" and isinstance(v, list):
                    for s in v:
                        if s not in src_ids:
                            errs.append(f"{p}.src: unknown source id {s}")
                elif k != "sources":
                    walk(v, f"{p}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{p}[{i}]")

    walk({k: v for k, v in b.items() if k != "sources"}, "$")
    n = len(b.get("resid_dates", []))
    for t in b.get("india", []):
        if len(t.get("resid", [])) != n:
            errs.append(f"india {t.get('ticker')}: resid length {len(t.get('resid', []))} != resid_dates {n}")
    if len(b.get("nifty_resid", [])) != n:
        errs.append("nifty_resid length != resid_dates")
    hm = b.get("heatmap", {})
    if len(hm.get("cells", [])) != len(hm.get("targets", [])):
        errs.append("heatmap rows != targets")
    for row in hm.get("cells", []):
        if len(row) != len(hm.get("origins", [])):
            errs.append("heatmap cols != origins")
            break
    secs = b.get("securities", {})
    for t in b.get("tape", []):
        if t not in secs:
            errs.append(f"tape ticker {t} missing from securities")
    for o in b.get("origins", []):
        if o["ticker"] not in secs:
            errs.append(f"origin {o['ticker']} missing from securities")
    for t in b.get("india", []):
        if t["ticker"] not in secs:
            errs.append(f"india {t['ticker']} missing from securities")
        if t.get("parent") and t["parent"] not in secs:
            errs.append(f"india {t['ticker']} parent {t['parent']} missing from securities")
    ids = [s["id"] for s in b.get("sources", [])]
    if len(ids) != len(set(ids)):
        errs.append("duplicate source ids")
    errs += v2_checks(b)
    return errs


def v2_checks(b: dict[str, Any]) -> list[str]:
    """Consistency of the optional V2 sections (lengths, tickers, weights)."""
    errs: list[str] = []
    bt = b.get("backtest")
    india = {t.get("ticker") for t in b.get("india", [])}
    nd = len(bt.get("dates", [])) if isinstance(bt, dict) else None
    for m in b.get("models", []) or []:
        tk = m.get("ticker")
        if tk not in india:
            errs.append(f"models {tk}: not an india target")
        if nd is not None and len(m.get("oos_resid", [])) != nd:
            errs.append(f"models {tk}: oos_resid length {len(m.get('oos_resid', []))} != backtest.dates {nd}")
        hs = [h.get("h") for h in m.get("horizons", [])]
        if 1 not in hs or len(hs) != len(set(hs)):
            errs.append(f"models {tk}: horizons must contain h=1 once (got {hs})")
        w = sum(c.get("weight", 0) for c in (m.get("components") or {}).values())
        if w > 1 + 1e-6:
            errs.append(f"models {tk}: component weights sum {w:.4f} > 1")
    if isinstance(bt, dict):
        if "nifty_oos_resid" in bt and len(bt["nifty_oos_resid"]) != nd:
            errs.append("backtest.nifty_oos_resid length != backtest.dates")
        ws = (bt.get("ensemble") or {}).get("weights") or {}
        if ws and abs(sum(ws.values()) - 1) > 1e-4:
            errs.append(f"backtest.ensemble.weights sum {sum(ws.values()):.5f} != 1")
        if any(v < 0 for v in ws.values()):
            errs.append("backtest.ensemble.weights has a negative weight")
    return errs


def validate_bundle(b: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    check(b, BUNDLE, "$", errs)
    errs += cross_checks(b)
    return errs


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    path = Path(argv[0]) if argv else Path(__file__).resolve().parents[1] / "public" / "data.json"
    b = json.loads(path.read_text())
    errs = validate_bundle(b)
    if errs:
        print(f"INVALID: {len(errs)} problem(s)")
        for e in errs[:80]:
            print("  -", e)
        return 1
    print(f"OK: {path} matches src/types/data.ts ({path.stat().st_size/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
