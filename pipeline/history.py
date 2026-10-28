"""F4 HISTORY builder: cases, event studies, scatters, P/E-vs-drawdown, overlays, replay windows,
DeepSeek next-day table and contagion calibration.

Entry point used by build_data.py (DATA-CORE):

    history_section, calibration_partial, extra_sources = build_history(ctx)

`ctx` implements pipeline.context.BuildContext. Config comes from `ctx.cfg["history"]` (history.yaml,
included from universe.yaml); if the loader did not merge it, history.yaml is read directly.
Dev self-test on real (cached) data without DATA-CORE:

    .venv/bin/python -m pipeline.history --selftest
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
import yaml

from pipeline import events as ev
from pipeline import shiller
from pipeline.events import ds, fnum, json_safe, quantity

ROOT = Path(__file__).resolve().parents[1]
HISTORY_YAML = ROOT / "history.yaml"

US_INDICES = {"^GSPC", "^IXIC", "^NDX", "^SOX", "^DJI", "^IXTC", "^VIX"}
IN_INDICES = {"^NSEI", "^BSESN", "^CNXIT"}
LOCAL_INDEX = {"US": "^GSPC", "IN": "^NSEI"}
INDEX_LABEL = {"^GSPC": "S&P 500", "^NSEI": "Nifty 50", "^BSESN": "Sensex", "^CNXIT": "Nifty IT"}


# ============================================================================ config helpers
def load_history_cfg(cfg: dict[str, Any] | None) -> dict[str, Any]:
    h = (cfg or {}).get("history")
    if isinstance(h, dict) and h.get("cases"):
        return h
    with open(HISTORY_YAML) as f:
        return yaml.safe_load(f)["history"]


def market_of(ticker: str, hint: str | None = None) -> str:
    if hint:
        return hint
    t = ticker.upper()
    if t in IN_INDICES or t.endswith(".NS") or t.endswith(".BO"):
        return "IN"
    if t == "^N225" or t.endswith(".T"):
        return "JP"
    if t.endswith(".DE") or t.endswith(".PA") or t.endswith(".SW"):
        return "EU"
    if t.endswith("=X"):
        return "FX"
    return "US"


class _Data:
    """Memoised access to ctx price series."""

    def __init__(self, ctx: Any):
        self.ctx = ctx
        self._close: dict[str, pd.Series | None] = {}
        self._ret: dict[str, pd.Series | None] = {}

    def close(self, ticker: str) -> pd.Series | None:
        if ticker not in self._close:
            try:
                df = self.ctx.prices(ticker)
            except Exception:  # noqa: BLE001 - missing ticker must not kill the build
                df = None
            self._close[ticker] = ev.close_series(df, "Close")
        return self._close[ticker]

    def ret(self, ticker: str) -> pd.Series | None:
        """Daily log returns of AdjClose (own calendar)."""
        if ticker not in self._ret:
            r = None
            try:
                r = self.ctx.logret(ticker)
            except Exception:  # noqa: BLE001
                r = None
            if r is not None:
                r = r.astype(float)
                r.index = pd.to_datetime(r.index)
                r = r[np.isfinite(r)].sort_index()
            self._ret[ticker] = r if r is not None and not r.empty else None
        return self._ret[ticker]


def _target_maps(ctx: Any) -> tuple[dict[str, dict], dict[str, dict]]:
    targets = {t["ticker"]: t for t in (getattr(ctx, "targets", None) or [])}
    origins = {o["ticker"]: o for o in (getattr(ctx, "origins", None) or [])}
    return targets, origins


def expand_members(spec: list[str], targets: dict[str, dict], origins: dict[str, dict]) -> list[str]:
    out: list[str] = []
    for m in spec:
        m = str(m)
        if m.startswith("@tier:"):
            tier = m.split(":", 1)[1].upper()
            out += [t for t, d in targets.items() if tier == "ALL" or str(d.get("tier", "")).upper() == tier]
        elif m.startswith("@origins:"):
            grp = m.split(":", 1)[1].lower()
            out += [t for t, d in origins.items() if grp == "all" or str(d.get("group", "")).lower() == grp]
        else:
            out.append(m)
    seen: set[str] = set()
    return [t for t in out if not (t in seen or seen.add(t))]


def _label(t: str, targets: dict[str, dict]) -> str:
    d = targets.get(t)
    return str(d.get("display") or t) if d else t


def _tier(t: str, targets: dict[str, dict]) -> str | None:
    d = targets.get(t)
    return str(d["tier"]) if d and d.get("tier") else None


def _src_status(src_ids: list[str], sources: dict[str, dict]) -> str:
    ver = [sources.get(s, {}).get("verification") for s in src_ids]
    if any(v in ("PRIMARY", "SECONDARY") for v in ver):
        return "SOURCED"
    return "UNVERIFIED"


# ============================================================================ sections
def build_sources(h: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for s in h.get("sources", []) or []:
        out.append(
            {
                "id": s["id"],
                "title": s.get("title") or s["id"],
                "publisher": s.get("publisher"),
                "url": s.get("url") or "",
                "date": None if s.get("date") is None else str(s.get("date")),
                "quote": s.get("quote"),
                "verification": s.get("verification", "UNVERIFIED"),
                "accessed": str(s.get("accessed") or h.get("accessed") or ""),
                "note": s.get("note"),
            }
        )
    return out


def build_cases(h: dict, data: _Data, sources: dict[str, dict]) -> list[dict[str, Any]]:
    cases = []
    for c in h.get("cases", []) or []:
        rows: list[dict[str, Any]] = []
        notes: list[str] = []
        for d in c.get("drawdowns", []) or []:
            if "sourced" in d:
                sv = d["sourced"]
                src = list(d.get("src", []))
                rows.append(
                    {
                        "label": d["label"],
                        "ticker": None,
                        "peak_date": None if sv.get("peak_date") is None else str(sv.get("peak_date")),
                        "peak": fnum(sv.get("peak")),
                        "trough_date": None if sv.get("trough_date") is None else str(sv.get("trough_date")),
                        "trough": fnum(sv.get("trough")),
                        "drawdown": fnum(sv.get("drawdown")),
                        "days_to_bottom": sv.get("days_to_bottom"),
                        "days_to_recover": sv.get("days_to_recover"),
                        "recovered_date": sv.get("recovered_date"),
                        "status": _src_status(src, sources),
                        "src": src,
                        "note": d.get("note"),
                    }
                )
                continue
            t = d["ticker"]
            s = data.close(t)
            res = ev.drawdown(s, d["peak_search"][0], d["peak_search"][1], d["trough_end"], d.get("recover_end"))
            if res is None:
                notes.append(f"No Yahoo price data for {t} covering {d['peak_search'][0]}..{d['trough_end']}; row omitted.")
                continue
            extra = res.pop("_notes")
            note_bits = list(extra)
            if d.get("note"):
                note_bits.insert(0, d["note"])
            if res["recovered_date"] is None:
                last = ds(s.index[-1]) if s is not None else None
                note_bits.append(f"not back to the peak as of {last}")
            rows.append(
                {
                    "label": d.get("label", t),
                    "ticker": t,
                    **res,
                    "status": "COMPUTED",
                    "src": ["hist_yahoo"],
                    "note": "; ".join(note_bits) if note_bits else None,
                }
            )
        for m in c.get("computed_moves", []) or []:
            r = ev.day_return(data.close(m["ticker"]), m["date"])
            if r is None:
                notes.append(f"COMPUTED: no Yahoo close for {m['ticker']} on {m['date']}.")
                continue
            notes.append(f"COMPUTED: {m.get('label', m['ticker'])} ({m['ticker']}) {m['date']}: {r * 100:+.2f}% close-to-close.")
        src = list(c.get("src", []))
        if any(r_["status"] == "COMPUTED" for r_ in rows) and "hist_yahoo" not in src:
            src.append("hist_yahoo")
        cases.append(
            {
                "id": c["id"],
                "name": c["name"],
                "period": c.get("period", ""),
                "what_broke": c.get("what_broke", ""),
                "crash_types": list(c.get("crash_types", [])),
                "drawdowns": rows,
                "linked": c.get("linked", ""),
                "india": c.get("india", ""),
                "src": src,
                "notes": notes,
            }
        )
    return cases


def _member_setup(t: str, group_index: str, group_day0: str) -> tuple[str, str, str]:
    """Pick the index/day0 a member is measured against (member market may differ from the group's)."""
    mk = market_of(t)
    idx_mk = market_of(group_index)
    if mk == idx_mk or mk not in LOCAL_INDEX:
        return group_index, group_day0, ""
    idx = LOCAL_INDEX[mk]
    day0 = "same" if mk == "US" else group_day0
    return idx, day0, f" (vs {INDEX_LABEL.get(idx, idx)})"


def build_event_studies(h: dict, data: _Data, targets: dict, origins: dict) -> list[dict[str, Any]]:
    out = []
    pre, post = ev.PRE_DAYS, ev.POST_DAYS
    for e in h.get("event_studies", []) or []:
        groups = []
        missing: list[str] = []
        fallbacks: list[str] = []
        for g in e.get("groups", []) or []:
            gdate = g.get("date", e["date"])
            members = []
            paths = []
            for t in expand_members(g.get("members", []), targets, origins):
                idx, day0, suffix = _member_setup(t, g["index"], g.get("day0", "same"))
                res = ev.market_model_car(data.ret(t), data.ret(idx), gdate, day0=day0, pre=pre, post=post)
                if res is None:
                    missing.append(t)
                    continue
                if res["method"] == "market_adjusted":
                    fallbacks.append(t)
                members.append(
                    {
                        "ticker": t,
                        "label": _label(t, targets) + suffix,
                        "tier": _tier(t, targets),
                        "car": res["car"],
                        "ar0": res["ar0"],
                        "ar1": res["ar1"],
                        "car_end": res["car_end"],
                        "method": res["method"],
                    }
                )
                paths.append(res["car"])
            groups.append({"name": g["name"], "index": g["index"], "members": members, "mean_car": ev.mean_path(paths)})
        note = (
            "Log abnormal returns cumulated from day -5; market model (alpha, beta on trading days -250..-11 vs the "
            "group's local index), market-adjusted when fewer than 120 estimation days. Day 0 = first session on/after "
            "the event date ('next' groups: first session after it, i.e. the India reaction to a US close)."
        )
        if missing:
            note += f" No data around the event: {', '.join(sorted(set(missing)))}."
        if fallbacks:
            note += f" Market-adjusted: {', '.join(sorted(set(fallbacks)))}."
        out.append(
            {
                "id": e["id"],
                "label": e["label"],
                "date": str(e["date"]),
                "crash_types": list(e.get("crash_types", [])),
                "window": [-pre, post],
                "groups": groups,
                "src": list(e.get("src", [])),
                "note": note,
            }
        )
    return out


def _india_next(india_dates: pd.DatetimeIndex, d: Any) -> pd.Timestamp | None:
    p = ev.first_on_or_after(india_dates, d, strict=True)
    return india_dates[p] if p is not None else None


def build_us_vs_india(h: dict, ctx: Any, data: _Data, targets: dict) -> list[dict[str, Any]]:
    try:
        x = ctx.aligned_to_india("^SOX")
    except Exception:  # noqa: BLE001
        x = None
    if x is None or len(x) == 0:
        return []
    x = x.astype(float)
    x.index = pd.to_datetime(x.index)
    w0, w1 = (pd.Timestamp(d) for d in ctx.window)
    xw = x.loc[w0:w1].dropna()
    if xw.empty:
        return []
    thr = float(xw.quantile(0.05))
    days: dict[pd.Timestamp, str | None] = {d: None for d in xw[xw <= thr].index}
    india_dates = pd.DatetimeIndex(ctx.india_dates)
    for se in h.get("scatter_events", []) or []:
        t = _india_next(india_dates, se["us_date"])
        if t is not None and w0 <= t <= w1 and t in xw.index:
            days[t] = se["id"]
    sox = data.close("^SOX")
    out = []
    for t in sorted(days):
        us_date = None
        if sox is not None:
            before = sox.loc[: t - pd.Timedelta(days=1)]
            us_date = ds(before.index[-1]) if not before.empty else None
        xv = fnum(xw.loc[t], 6)
        for tk, d in targets.items():
            r = data.ret(tk)
            if r is None:
                continue
            key = t if market_of(tk, d.get("market")) == "IN" else (pd.Timestamp(us_date) if us_date else None)
            if key is None or key not in r.index:
                continue
            out.append(
                {
                    "date": ds(t),
                    "us_date": us_date,
                    "event": days[t],
                    "x_sox": xv,
                    "ticker": tk,
                    "tier": d.get("tier"),
                    "r": fnum(r.loc[key], 6),
                }
            )
    return out


def build_pe_points(h: dict, data: _Data, sources: dict[str, dict]) -> tuple[list[dict], dict, list[str]]:
    warnings: list[str] = []
    sh = h.get("shiller", {}) or {}
    path = shiller.fetch_shiller(sh.get("url", shiller.DEFAULT_URL))
    df = shiller.load_shiller(path)
    if df is None:
        warnings.append("Shiller ie_data.xls unavailable (offline and not cached); Shiller episodes omitted.")
    pts = shiller.episodes(df, sh.get("episodes", []) or [], sh.get("src", "hist_shiller_ie"))
    for p in h.get("pe_points", []) or []:
        spec = p["drawdown_from"]
        res = ev.drawdown(data.close(spec["ticker"]), spec["peak_search"][0], spec["peak_search"][1], spec["trough_end"])
        if res is None:
            warnings.append(f"pe_point {p['id']}: no {spec['ticker']} data; omitted.")
            continue
        src = list(p.get("src", []))
        note = (p.get("note") or "") + (
            f" Drawdown COMPUTED from {spec['ticker']} closes: peak {res['peak_date']} ({res['peak']:.2f}) → trough "
            f"{res['trough_date']} ({res['trough']:.2f})."
        )
        pts.append(
            {
                "id": p["id"],
                "label": p["label"],
                "market": p.get("market", ""),
                "peak_date": res["peak_date"],
                "pe": fnum(p["pe"]),
                "pe_kind": p.get("pe_kind", "trailing"),
                "pe_status": _src_status(src, sources),
                "drawdown": res["drawdown"],
                "drawdown_status": "COMPUTED",
                "src": src + (["hist_yahoo"] if "hist_yahoo" not in src else []),
                "note": note.strip(),
            }
        )
    clean = [{k: v for k, v in p.items() if not k.startswith("_")} for p in pts]
    fit = ev.ols_fit(np.array([p["pe"] for p in clean], float), np.array([p["drawdown"] for p in clean], float))
    if fit is None:
        fit = {"slope": None, "intercept": None, "r2": None, "n": len(clean)}
    return clean, fit, warnings


def build_ai_basket_pe(ctx: Any, fit: dict) -> dict[str, Any]:
    secs = getattr(ctx, "securities", None) or {}
    num_now = den_now = num_pre = den_pre = 0.0
    for o in getattr(ctx, "origins", None) or []:
        s = secs.get(o["ticker"]) or {}
        m = fnum(s.get("mcap_usd"))
        pe = fnum(s.get("pe_ttm"))
        pre = fnum(s.get("pe_pre_chatgpt_median"))
        if m and m > 0 and pe and pe > 0:
            num_now += m
            den_now += m / pe
        if m and m > 0 and pre and pre > 0:
            num_pre += m
            den_pre += m / pre
    now = num_now / den_now if den_now > 0 else None
    pre_v = num_pre / den_pre if den_pre > 0 else None
    implied = None
    if now is not None and fit.get("slope") is not None:
        implied = max(-0.99, min(0.0, fit["intercept"] + fit["slope"] * now))
    return {"now": fnum(now, 3), "pre_chatgpt_median": fnum(pre_v, 3), "implied_drawdown": fnum(implied, 6)}


def build_overlay(h: dict, data: _Data) -> list[dict[str, Any]]:
    ov = h.get("overlay", {}) or {}
    span = int(ov.get("span", 750))
    out = []
    for spec in ov.get("dotcom", []) or []:
        s = data.close(spec["ticker"])
        if s is None:
            continue
        win = s.loc[spec["peak_search"][0] : spec["peak_search"][1]]
        if win.empty:
            continue
        pk = win.idxmax()
        out.append({"label": f"{spec['label']} (peak {ds(pk)})", "ticker": spec["ticker"], "peak_date": ds(pk), **ev.index_to_peak(s, pk, span, span)})
    for spec in ov.get("today", []) or []:
        s = data.close(spec["ticker"])
        if s is None:
            continue
        pk = s.idxmax()
        out.append({"label": f"{spec['label']} (all-time high {ds(pk)})", "ticker": spec["ticker"], "peak_date": ds(pk), **ev.index_to_peak(s, pk, span, span)})
    return out


def build_worst_windows(h: dict, data: _Data) -> dict[str, Any]:
    ww = h.get("worst_windows", {}) or {}
    since = pd.Timestamp(ww.get("since", "1994-05-04"))
    out: dict[str, Any] = {}
    for key, tk in (ww.get("series") or {"SOX": "^SOX", "NDX": "^NDX"}).items():
        s = data.close(tk)
        r = ev.log_returns(s.loc[since:]) if s is not None else None
        d1, d1d = ev.worst_window(r, 1)
        d21, d21d = ev.worst_window(r, 21)
        d252, d252d = ev.worst_window(r, 252)
        out[key] = {"d1": d1, "d1_date": d1d, "d21": d21, "d21_end": d21d, "d252": d252, "d252_end": d252d}
    return out


REPLAY_KEYS_US = {"SOX": "^SOX", "NDX": "^NDX", "SPX": "^GSPC", "IXIC": "^IXIC"}
REPLAY_KEYS_IN = {"NIFTY": "^NSEI", "SENSEX": "^BSESN", "NIFTYIT": "^CNXIT"}


def build_replay_windows(cfg: dict, h: dict, data: _Data) -> list[dict[str, Any]]:
    wins = (cfg or {}).get("replay_windows") or h.get("default_replay_windows", [])
    out = []
    for w in wins:
        moves: dict[str, float | None] = {}
        for k, tk in REPLAY_KEYS_US.items():
            moves[k] = ev.log_move(data.close(tk), w["start"], w["end"])
        for k, tk in REPLAY_KEYS_IN.items():
            moves[k] = ev.log_move_next_after(data.close(tk), w["start"], w["end"])
        note = (
            "COMPUTED log moves, close(start) → close(end) for US series; India series from the last NSE close on/before "
            "start to the first NSE close after end (captures the next-session reaction). Window dates are a model choice."
        )
        if w.get("note"):
            note = f"{w['note']} {note}"
        out.append(
            {
                "id": w["id"],
                "label": w.get("label", w["id"]),
                "start": str(w["start"]),
                "end": str(w["end"]),
                "moves": moves,
                "status": "COMPUTED",
                "src": list(w.get("src", []) or []),
                "note": note,
            }
        )
    return out


def _simple(x: float | None) -> float | None:
    return None if x is None else fnum(math.expm1(x), 6)


def build_deepseek_next_day(h: dict, data: _Data, targets: dict) -> list[dict[str, Any]]:
    cfg = h.get("deepseek_next_day", {}) or {}
    d0, d1 = cfg.get("d0", "2025-01-27"), cfg.get("d1", "2025-01-28")
    out = []
    for tk, d in targets.items():
        r = data.ret(tk)
        mk = market_of(tk, d.get("market"))
        idx = cfg.get("index_in", "^NSEI") if mk == "IN" else cfg.get("index_us", "^GSPC")
        if r is None:
            continue
        r0 = r.get(pd.Timestamp(d0))
        r1 = r.get(pd.Timestamp(d1))
        if r0 is None and r1 is None:
            continue
        ar = ev.abnormal_return(r, data.ret(idx), d1, est_anchor=d0)
        out.append(
            {
                "ticker": tk,
                "tier": d.get("tier"),
                "r_jan27": _simple(fnum(r0)),
                "r_jan28": _simple(fnum(r1)),
                "ar_jan28": _simple(ar["ar"]) if ar else None,
            }
        )
    out.sort(key=lambda x: (x["r_jan28"] if x["r_jan28"] is not None else 9e9))
    return out


def build_contagion(h: dict, data: _Data, targets: dict, origins: dict) -> tuple[dict, list[str]]:
    cc = h.get("contagion", {}) or {}
    notes: list[str] = []
    out: dict[str, Any] = {}

    # ---- US: SMCI auditor resignation
    us = cc.get("us", {})
    comp = us.get("company", "SMCI")
    idx = us.get("index", "^GSPC")
    peers = [p for p in expand_members([us.get("peers", "@origins:chips")] if isinstance(us.get("peers"), str) else us.get("peers", []), targets, origins) if p != comp]
    ar_c = ev.abnormal_return(data.ret(comp), data.ret(idx), us.get("event", "2024-10-30"))
    peer_ars = {}
    for p in peers:
        a = ev.abnormal_return(data.ret(p), data.ret(idx), us.get("event", "2024-10-30"))
        if a is not None:
            peer_ars[p] = math.expm1(a["ar"])
    if ar_c is not None and peer_ars:
        ar_c_s = math.expm1(ar_c["ar"])
        med = float(np.median(list(peer_ars.values())))
        mean = float(np.mean(list(peer_ars.values())))
        detail = ", ".join(f"{k} {v * 100:+.1f}%" for k, v in sorted(peer_ars.items()))
        out["contagion_us"] = quantity(
            "calib.contagion_us",
            "US restatement contagion: peer abnormal return ÷ target abnormal return (SMCI, 30-Oct-2024)",
            [
                {"label": f"Median 1-day abnormal return of {len(peer_ars)} chip-origin peers vs S&P 500 (market model)", "value": med, "status": "COMPUTED", "src": ["hist_yahoo"], "note": detail},
                {"label": f"1 ÷ {comp} 1-day abnormal return ({ar_c_s * 100:+.1f}%)", "value": 1.0 / ar_c_s, "status": "COMPUTED", "src": ["hist_siliconangle_smci_ey", "hist_yahoo"], "note": None},
            ],
            unit="x",
            note=f"Median used (robust to peers' own news that day; e.g. earnings). Mean-based ratio {mean / ar_c_s:+.3f}. Engine default: same-group peers move contagion × target move.",
            editable=True,
            vmin=-1.0,
            vmax=1.0,
            step=0.01,
        )
    else:
        notes.append("contagion_us not computed: missing SMCI or peer data on 2024-10-30.")

    # ---- India: Satyam confession
    ind = cc.get("india", {})
    idx = ind.get("index", "^NSEI")
    move = fnum(ind.get("company_move", -0.77))
    peer_ars = {}
    for p in ind.get("peers", []):
        a = ev.abnormal_return(data.ret(p), data.ret(idx), ind.get("event", "2009-01-07"))
        if a is not None:
            peer_ars[p] = math.expm1(a["ar"])
    if peer_ars and move:
        mean = float(np.mean(list(peer_ars.values())))
        med = float(np.median(list(peer_ars.values())))
        detail = ", ".join(f"{k} {v * 100:+.1f}%" for k, v in sorted(peer_ars.items()))
        out["contagion_india"] = quantity(
            "calib.contagion_india",
            "India restatement contagion: peer abnormal return ÷ Satyam move (7-Jan-2009)",
            [
                {"label": f"Mean 1-day abnormal return of {len(peer_ars)} Indian IT peers vs Nifty 50 (market model)", "value": mean, "status": "COMPUTED", "src": ["hist_yahoo"], "note": detail},
                {"label": f"1 ÷ Satyam one-day move ({move * 100:.0f}%)", "value": 1.0 / move, "status": "SOURCED", "src": list(ind.get("src", [])), "note": "Raw move (not abnormal); sources report 77–78%."},
            ],
            unit="x",
            note=f"Median-based ratio {med / move:+.3f}. A negative value means peers outperformed the market on the day (flight to quality), i.e. no measured trust contagion.",
            editable=True,
            vmin=-1.0,
            vmax=1.0,
            step=0.01,
        )
    else:
        notes.append("contagion_india not computed: missing peer data on 2009-01-07.")
    return out, notes


# ============================================================================ entry point
def build_history(ctx: Any) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    h = load_history_cfg(getattr(ctx, "cfg", None))
    data = _Data(ctx)
    targets, origins = _target_maps(ctx)
    extra_sources = build_sources(h)
    src_map = {s["id"]: s for s in extra_sources}
    try:
        for sid in ctx.source_ids():
            src_map.setdefault(sid, {"verification": "SECONDARY"})
    except Exception:  # noqa: BLE001
        pass

    cases = build_cases(h, data, src_map)
    studies = build_event_studies(h, data, targets, origins)
    pts, fit, pe_warn = build_pe_points(h, data, src_map)
    calib, calib_notes = build_contagion(h, data, targets, origins)

    # Attach build notes to the relevant cases (visible provenance, never silent).
    by_id = {c["id"]: c for c in cases}
    for n in pe_warn + calib_notes:
        by_id.get("dotcom", cases[0] if cases else {"notes": []})["notes"].append(f"BUILD: {n}")
    if "deepseek" in by_id:
        by_id["deepseek"]["notes"].append(
            "deepseek_next_day: simple returns on 27-Jan-2025 and 28-Jan-2025; AR = market-model abnormal return on "
            "28-Jan vs the local index (Nifty 50; S&P 500 for US-listed names)."
        )

    section = {
        "cases": cases,
        "event_studies": studies,
        "us_vs_india": build_us_vs_india(h, ctx, data, targets),
        "pe_vs_drawdown": pts,
        "pe_fit": fit,
        "ai_basket_pe": build_ai_basket_pe(ctx, fit),
        "overlay": build_overlay(h, data),
        "worst_windows": build_worst_windows(h, data),
        "replay_windows": build_replay_windows(getattr(ctx, "cfg", {}) or {}, h, data),
        "deepseek_next_day": build_deepseek_next_day(h, data, targets),
    }
    return json_safe(section), json_safe(calib), json_safe(extra_sources)


# ============================================================================ self-test context
BUILTIN_TARGETS = [
    *[{"ticker": t, "tier": "A"} for t in ["OFSS.NS", "GVT&D.NS", "POWERINDIA.NS", "ENRIN.NS", "ABB.NS", "SCHNEIDER.NS"]],
    *[{"ticker": t, "tier": "B"} for t in ["INFY.NS", "TCS.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS", "LTM.NS", "PERSISTENT.NS", "COFORGE.NS", "MPHASIS.NS", "TATAELXSI.NS", "LTTS.NS", "CYIENT.NS"]],
    *[{"ticker": t, "tier": "C"} for t in ["NETWEB.NS", "E2E.NS", "SIFY", "ANANTRAJ.NS", "TECHNOE.NS", "TARIL.NS", "STLTECH.NS", "HFCL.NS", "POLYCAB.NS", "KEI.NS"]],
    *[{"ticker": t, "tier": "D"} for t in ["KAYNES.NS", "DIXON.NS", "CGPOWER.NS", "MOSCHIP.BO"]],
]
BUILTIN_ORIGINS = [
    *[{"ticker": t, "group": "chips"} for t in ["NVDA", "AMD", "AVGO", "TSM", "ASML", "MU", "INTC", "ARM", "MRVL", "SMCI"]],
    *[{"ticker": t, "group": "hyperscalers"} for t in ["MSFT", "GOOGL", "AMZN", "META", "ORCL"]],
    *[{"ticker": t, "group": "infra"} for t in ["VRT", "ETN", "GEV", "CEG", "VST", "CRWV"]],
    *[{"ticker": t, "group": "software"} for t in ["PLTR", "NOW", "CRM", "ADBE"]],
]


class SelfTestContext:
    """Minimal BuildContext over pipeline.prices (no fundamentals; securities empty)."""

    def __init__(self) -> None:
        from pipeline import prices

        self._prices = prices
        cfg: dict[str, Any] = {}
        uni = ROOT / "universe.yaml"
        if uni.exists():
            try:
                with open(uni) as f:
                    cfg = yaml.safe_load(f) or {}
            except Exception:  # noqa: BLE001 - universe may be mid-edit by DATA-CORE
                cfg = {}
        with open(HISTORY_YAML) as f:
            cfg["history"] = yaml.safe_load(f)["history"]
        self.cfg = cfg
        tg = cfg.get("india") or BUILTIN_TARGETS
        self.targets = [
            {"ticker": t["ticker"], "display": t.get("display") or t["ticker"].split(".")[0], "name": t.get("name", t["ticker"]), "tier": t["tier"], "parent": t.get("parent"), "market": t.get("market")}
            for t in tg
        ]
        og = cfg.get("origins") or BUILTIN_ORIGINS
        self.origins = [{"ticker": o["ticker"], "name": o.get("name", o["ticker"]), "group": o["group"]} for o in og]
        nifty = prices.get_history("^NSEI")
        if nifty is None:
            raise SystemExit("^NSEI unavailable; cannot build India calendar")
        self.india_dates = pd.DatetimeIndex(nifty.index)
        end = self.india_dates[-1]
        start = self.india_dates[self.india_dates.searchsorted(end - pd.DateOffset(years=3))]
        self.window = (start, end)
        self.securities: dict[str, dict] = {}
        fx = prices.get_history("USDINR=X")
        self.usd_inr = float(fx["Close"].iloc[-1]) if fx is not None else float("nan")
        self._mk = {t["ticker"]: t.get("market") for t in self.targets}

    def prices(self, ticker: str) -> pd.DataFrame | None:
        return self._prices.get_history(ticker)

    def logret(self, ticker: str) -> pd.Series | None:
        return self._prices.log_returns(self._prices.get_history(ticker))

    def aligned_to_india(self, ticker: str) -> pd.Series | None:
        r = self.logret(ticker)
        if r is None:
            return None
        mk = market_of(ticker, self._mk.get(ticker))
        idx = self.india_dates
        strict = mk not in ("IN", "JP")
        pos = idx.searchsorted(r.index, side="right" if strict else "left")
        ok = pos < len(idx)
        mapped = pd.Series(r.to_numpy()[ok], index=idx[pos[ok]])
        agg = mapped.groupby(level=0).sum()
        out = agg.reindex(idx).fillna(0.0)
        out.loc[: r.index[0]] = np.nan
        return out

    def source_ids(self) -> set[str]:
        return {s["id"] for s in (self.cfg.get("sources") or []) if isinstance(s, dict) and "id" in s}


def _summary(section: dict, calib: dict) -> str:
    lines = []
    for c in section["cases"]:
        dd = [f"{r['label']}: {r['drawdown'] * 100:.1f}%" for r in c["drawdowns"] if r.get("drawdown") is not None]
        lines.append(f"[{c['id']}] " + " | ".join(dd[:8]))
    for k, q in calib.items():
        v = q.get("value")
        lines.append(f"{k} = {v:+.4f} ({q['status']})" if v is not None else f"{k} = None ({q['status']})")
    f = section["pe_fit"]
    if f.get("slope") is not None:
        lines.append(f"pe_fit: drawdown = {f['intercept']:+.3f} {f['slope']:+.5f}*PE  r2={f['r2']:.3f} n={f['n']}")
    lines.append(f"pe points: " + ", ".join(f"{p['id']} PE {p['pe']:.1f} DD {p['drawdown'] * 100:.0f}%" for p in section["pe_vs_drawdown"]))
    lines.append(f"event studies: {len(section['event_studies'])}; us_vs_india points: {len(section['us_vs_india'])}; overlay series: {len(section['overlay'])}")
    lines.append("worst windows: " + json.dumps(section["worst_windows"]))
    for w in section["replay_windows"]:
        lines.append(f"replay {w['id']}: " + ", ".join(f"{k} {v * 100:+.1f}%" for k, v in w["moves"].items() if v is not None))
    lines.append(f"deepseek rows: {len(section['deepseek_next_day'])}; ai_basket_pe: {section['ai_basket_pe']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="AI CRASH MONITOR history builder")
    ap.add_argument("--selftest", action="store_true", help="build from cached/real prices without DATA-CORE")
    ap.add_argument("--out", default=str(ROOT / ".cache" / "history_preview.json"))
    a = ap.parse_args(argv)
    if not a.selftest:
        ap.print_help()
        return 0
    ctx = SelfTestContext()
    section, calib, srcs = build_history(ctx)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    payload = {"history": section, "calibration": calib, "sources": srcs}
    text = json.dumps(payload, allow_nan=False)
    Path(a.out).write_text(text)
    print(_summary(section, calib))
    print(f"wrote {a.out} ({len(text) / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
