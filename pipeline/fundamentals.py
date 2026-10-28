"""Valuation math and per-security fundamentals (DESIGN.md §3.4).

Pure helpers (unit-tested in tests/test_valuation.py) + `compute_security_fundamentals`, which turns
cached Yahoo data into the fundamentals part of a Security record.
"""
from __future__ import annotations

import math
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from pipeline.fetch_fund import df_row


def fnum(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


# ----------------------------------------------------------------------------- pure valuation math
def price_from(pe: float, eps: float) -> float:
    """Price = P/E x EPS."""
    return pe * eps


def move(e: float, d: float) -> float:
    """Layer-1 move = (1 - e)(1 - d) - 1  (e = earnings cut, d = multiple de-rating)."""
    return (1.0 - e) * (1.0 - d) - 1.0


def ai_premium(pe_now: float | None, pe_pre: float | None) -> float | None:
    """AI premium = current P/E / pre-ChatGPT median P/E - 1 (None unless both positive)."""
    if pe_now is None or pe_pre is None or pe_now <= 0 or pe_pre <= 0:
        return None
    return pe_now / pe_pre - 1.0


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def operating_leverage(
    rev: pd.Series | None,
    ebit: pd.Series | None,
    gross_margin: float | None,
    op_margin: float | None,
    lo: float = 1.0,
    hi: float = 4.0,
    min_rev_change: float = 0.02,
    default: float = 1.5,
) -> tuple[float, str, str]:
    """Operating leverage = incremental margin / current margin, clamped to [lo, hi].

    Uses the last two fiscal years of (revenue, EBIT). Falls back to gross margin / operating margin
    (fixed-opex approximation), then to `default` (USER_ASSUMPTION).
    Returns (value, method, status).
    """
    if rev is not None and ebit is not None:
        df = pd.concat([rev.rename("rev"), ebit.rename("ebit")], axis=1).dropna().sort_index()
        if len(df) >= 2:
            r1, r0 = float(df["rev"].iloc[-1]), float(df["rev"].iloc[-2])
            e1, e0 = float(df["ebit"].iloc[-1]), float(df["ebit"].iloc[-2])
            if r1 > 0 and r0 > 0 and e1 > 0 and abs(r1 - r0) / r0 >= min_rev_change:
                incr = (e1 - e0) / (r1 - r0)
                curr = e1 / r1
                ratio = incr / curr if curr > 0 else float("nan")
                if math.isfinite(ratio) and ratio > 0:
                    yr1, yr0 = df.index[-1].year, df.index[-2].year
                    return (
                        clamp(ratio, lo, hi),
                        f"incremental/current EBIT margin FY{yr1} vs FY{yr0} = {ratio:.2f} (clamped to [{lo:g},{hi:g}])",
                        "COMPUTED",
                    )
    if gross_margin is not None and op_margin is not None and op_margin > 0 and gross_margin > 0:
        ratio = gross_margin / op_margin
        return clamp(ratio, lo, hi), f"fallback gross/operating margin = {ratio:.2f} (clamped)", "COMPUTED"
    return default, "fallback default (statements unusable)", "USER_ASSUMPTION"


def ttm_sum(s: pd.Series | None, n: int = 4, max_span_days: int = 300) -> float | None:
    """Sum of the last n non-null quarterly values if they are consecutive quarters."""
    if s is None:
        return None
    s = s.dropna().sort_index()
    if len(s) < n:
        return None
    last = s.iloc[-n:]
    span = (last.index[-1] - last.index[0]).days
    if span > max_span_days:
        return None
    return float(last.sum())


def earnings_table(earn: pd.DataFrame | None, tz: str) -> pd.Series | None:
    """Reported quarterly EPS indexed by the local announcement date (ascending, de-duplicated)."""
    if earn is None or not isinstance(earn, pd.DataFrame) or earn.empty or "Reported EPS" not in earn.columns:
        return None
    s = pd.to_numeric(earn["Reported EPS"], errors="coerce")
    idx = pd.DatetimeIndex(pd.to_datetime(s.index))
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    local = idx.tz_convert(ZoneInfo(tz)).tz_localize(None).normalize()
    s = pd.Series(s.to_numpy(), index=local).dropna()
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s if not s.empty else None


def ttm_eps_series(reported: pd.Series | None, dates: pd.DatetimeIndex, max_span_days: int = 400) -> pd.Series:
    """TTM EPS valid on each date d = sum of the last 4 reports announced strictly before d.

    No look-ahead: a report announced on local date a is first used on dates > a. Requires the four
    reports to span <= max_span_days (i.e. four consecutive quarters), else NaN.
    """
    out = pd.Series(np.nan, index=pd.DatetimeIndex(dates), dtype=float)
    if reported is None or len(reported) < 4:
        return out
    rep_dates = reported.index.to_numpy()
    vals = reported.to_numpy(dtype=float)
    roll = np.full(len(vals), np.nan)
    for i in range(3, len(vals)):
        span = (reported.index[i] - reported.index[i - 3]).days
        if span <= max_span_days:
            roll[i] = vals[i - 3 : i + 1].sum()
    # for each date, index of the last report with announcement date < d
    pos = np.searchsorted(rep_dates, out.index.to_numpy(), side="left") - 1
    ok = pos >= 0
    res = np.full(len(out), np.nan)
    res[ok] = roll[pos[ok]]
    out[:] = res
    return out


def pe_series(close: pd.Series, ttm_eps: pd.Series) -> pd.Series:
    """Daily P/E = split-adjusted close / TTM EPS (NaN where EPS <= 0)."""
    eps = ttm_eps.reindex(close.index)
    pe = close / eps
    pe[(eps <= 0) | eps.isna()] = np.nan
    return pe


def pre_chatgpt_median(pe: pd.Series, chatgpt_date: str | pd.Timestamp, years: int = 3, min_obs: int = 250) -> tuple[float | None, int]:
    """Median P/E over [chatgpt_date - years, chatgpt_date) (pre-ChatGPT window)."""
    end = pd.Timestamp(chatgpt_date)
    start = end - pd.DateOffset(years=years)
    w = pe[(pe.index >= start) & (pe.index < end)].dropna()
    n = int(len(w))
    if n < min_obs:
        return None, n
    return float(np.median(w.to_numpy())), n


def ret_since(close: pd.Series, date: str | pd.Timestamp) -> float | None:
    """Simple price return from the close on/just before `date` to the latest close."""
    c = close.dropna()
    base = c[c.index <= pd.Timestamp(date)]
    if base.empty or c.empty:
        return None
    return float(c.iloc[-1] / base.iloc[-1] - 1.0)


# ----------------------------------------------------------------------------- per-security fundamentals
def _info(f: dict[str, Any], key: str) -> Any:
    info = f.get("info") or {}
    return info.get(key) if isinstance(info, dict) else None


def compute_security_fundamentals(
    ticker: str,
    fund: dict[str, Any],
    close: pd.Series | None,
    market_tz: str,
    usd_per: dict[str, float],
    settings: dict[str, Any],
    price_currency: str | None,
) -> dict[str, Any]:
    """Fundamentals block for one security. Every output is COMPUTED from Yahoo data or None."""
    notes: list[str] = []
    out: dict[str, Any] = {k: None for k in (
        "shares", "mcap_local", "pe_ttm", "eps_ttm", "pe_basis", "pe_pre_chatgpt_median", "pe_pre_chatgpt_n",
        "ai_premium", "revenue_ttm", "revenue_ttm_usd", "financial_currency", "ebit_margin", "gross_margin",
        "net_debt_usd", "ebitda_ttm_usd", "capex_ttm_usd", "capex_quarters", "op_leverage_value",
        "op_leverage_method", "op_leverage_status", "currency")}
    out["capex_quarters"] = []
    fi = fund.get("fast_info") or {}
    cur = (_info(fund, "currency") or fi.get("currency") or price_currency or "USD")
    out["currency"] = str(cur).upper() if cur else None
    fin_cur = str(_info(fund, "financialCurrency") or out["currency"] or "USD").upper()
    out["financial_currency"] = fin_cur
    fx_fin = usd_per.get(fin_cur)

    shares = fnum(fi.get("shares")) or fnum(_info(fund, "sharesOutstanding"))
    out["shares"] = shares
    mcap = fnum(_info(fund, "marketCap")) or fnum(fi.get("marketCap"))
    if mcap is None and shares and close is not None and not close.dropna().empty:
        mcap = shares * float(close.dropna().iloc[-1])
        notes.append("mcap = shares x last close (Yahoo marketCap missing)")
    out["mcap_local"] = mcap

    # ---- P/E on the earnings-calendar basis (consistent now vs pre-ChatGPT)
    rep = earnings_table(fund.get("earnings_dates"), market_tz)
    if close is not None and not close.dropna().empty and rep is not None and len(rep) >= 4:
        c = close.dropna()
        ttm = ttm_eps_series(rep, c.index)
        pe = pe_series(c, ttm)
        eps_now = fnum(ttm.iloc[-1])
        out["eps_ttm"] = eps_now
        if eps_now is not None and eps_now > 0:
            out["pe_ttm"] = float(c.iloc[-1] / eps_now)
            out["pe_basis"] = "calendar_reported"
        med, n = pre_chatgpt_median(pe, settings["pre_chatgpt_date"], settings.get("pre_chatgpt_window_years", 3),
                                    settings.get("pre_chatgpt_min_obs", 250))
        out["pe_pre_chatgpt_median"] = med
        out["pe_pre_chatgpt_n"] = n
        # sanity check vs Yahoo trailing P/E (different EPS basis, but should be same order of magnitude)
        ytr = fnum(_info(fund, "trailingPE"))
        if out["pe_ttm"] and ytr and not (1 / 3 <= out["pe_ttm"] / ytr <= 3):
            notes.append(f"calendar-EPS P/E {out['pe_ttm']:.1f} vs Yahoo trailing P/E {ytr:.1f} differ >3x; premium suppressed")
            out["pe_pre_chatgpt_median"] = None
    if out["pe_ttm"] is None:
        ytr = fnum(_info(fund, "trailingPE"))
        if ytr and ytr > 0:
            out["pe_ttm"] = ytr
            out["pe_basis"] = "yahoo_trailing"
            out["eps_ttm"] = fnum(_info(fund, "trailingEps"))
            out["pe_pre_chatgpt_median"] = None
            notes.append("P/E from Yahoo trailingPE (no usable earnings calendar); AI premium not computable")
    if out["pe_basis"] == "calendar_reported":
        out["ai_premium"] = ai_premium(out["pe_ttm"], out["pe_pre_chatgpt_median"])

    # ---- statements
    q_is = fund.get("quarterly_income_stmt")
    a_is = fund.get("income_stmt")
    rev_q = df_row(q_is, ["Total Revenue", "Operating Revenue"])
    oi_q = df_row(q_is, ["Operating Income", "Total Operating Income As Reported", "EBIT"])
    gp_q = df_row(q_is, ["Gross Profit"])
    ebitda_q = df_row(q_is, ["EBITDA", "Normalized EBITDA"])
    rev_a = df_row(a_is, ["Total Revenue", "Operating Revenue"])
    oi_a = df_row(a_is, ["Operating Income", "Total Operating Income As Reported", "EBIT"])
    gp_a = df_row(a_is, ["Gross Profit"])

    rev_ttm = ttm_sum(rev_q)
    oi_ttm = ttm_sum(oi_q)
    gp_ttm = ttm_sum(gp_q)
    basis = "TTM quarters"
    if rev_ttm is None and rev_a is not None and not rev_a.dropna().empty:
        rev_ttm = float(rev_a.dropna().iloc[-1])
        oi_ttm = float(oi_a.dropna().iloc[-1]) if oi_a is not None and not oi_a.dropna().empty else None
        gp_ttm = float(gp_a.dropna().iloc[-1]) if gp_a is not None and not gp_a.dropna().empty else None
        basis = "latest fiscal year"
    out["revenue_ttm"] = rev_ttm
    if rev_ttm is not None and fx_fin:
        out["revenue_ttm_usd"] = rev_ttm * fx_fin
    if rev_ttm and rev_ttm > 0:
        if oi_ttm is not None:
            out["ebit_margin"] = oi_ttm / rev_ttm
        if gp_ttm is not None:
            out["gross_margin"] = gp_ttm / rev_ttm
    if out["ebit_margin"] is None:
        om = fnum(_info(fund, "operatingMargins"))
        if om is not None:
            out["ebit_margin"] = om
            basis = "Yahoo operatingMargins"
    if out["gross_margin"] is None:
        out["gross_margin"] = fnum(_info(fund, "grossMargins"))
    if rev_ttm is not None:
        notes.append(f"revenue/margins basis: {basis} ({fin_cur})")

    ol, method, status = operating_leverage(
        rev_a, oi_a, out["gross_margin"], out["ebit_margin"],
        lo=settings.get("op_leverage_min", 1.0), hi=settings.get("op_leverage_max", 4.0),
        min_rev_change=settings.get("op_leverage_min_rev_change", 0.02),
        default=settings.get("op_leverage_default", 1.5),
    )
    out["op_leverage_value"], out["op_leverage_method"], out["op_leverage_status"] = ol, method, status

    # ---- credit
    bs = fund.get("quarterly_balance_sheet")
    debt = df_row(bs, ["Total Debt"])
    cash = df_row(bs, ["Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"])
    if debt is not None and not debt.dropna().empty and fx_fin:
        d_last = float(debt.dropna().iloc[-1])
        c_last = float(cash.dropna().iloc[-1]) if cash is not None and not cash.dropna().empty else 0.0
        out["net_debt_usd"] = (d_last - c_last) * fx_fin
    eb = ttm_sum(ebitda_q)
    if eb is not None and fx_fin:
        out["ebitda_ttm_usd"] = eb * fx_fin

    # ---- capex (spenders)
    cf_q = fund.get("quarterly_cashflow")
    capex_q = df_row(cf_q, ["Capital Expenditure"])
    if capex_q is not None and fx_fin:
        cq = capex_q.dropna().sort_index()
        tt = ttm_sum(cq)
        if tt is not None:
            out["capex_ttm_usd"] = abs(tt) * fx_fin
        else:
            cf_a = df_row(fund.get("cashflow"), ["Capital Expenditure"])
            if cf_a is not None and not cf_a.dropna().empty:
                out["capex_ttm_usd"] = abs(float(cf_a.dropna().iloc[-1])) * fx_fin
                notes.append("capex: latest fiscal year (quarterly series incomplete)")
        out["capex_quarters"] = [
            {"period": d.strftime("%Y-%m-%d"), "value_usd": abs(float(v)) * fx_fin} for d, v in cq.iloc[-8:].items()
        ]
    out["notes"] = notes
    return out
