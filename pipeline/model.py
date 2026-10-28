"""Layer-2 estimation: India-target regressions, Nifty model, downside, rolling, heatmap,
peer betas, factor maps, parent (Dimson) maps (DESIGN.md §3.3)."""
from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd

from pipeline import stats
from pipeline.align import align_series

SPEC_MAIN = "r_i,t = a + b_SOX x_SOX,t + b_NDX x_NDX,t + b_P x_P,t + b_N r_NIFTY,t + e_i,t"
SPEC_MAIN_NOP = "r_i,t = a + b_SOX x_SOX,t + b_NDX x_NDX,t + b_N r_NIFTY,t + e_i,t"
SPEC_NIFTY = "r_NIFTY,t = c0 + c_SOX x_SOX,t + c_NDX x_NDX,t + e_N,t"


class Estimator:
    """Holds aligned series for one build. `logret(t)` gives own-calendar log returns."""

    def __init__(self, cfg: dict[str, Any], logret: Callable[[str], pd.Series | None],
                 market_of: Callable[[str], str], window: tuple[pd.Timestamp, pd.Timestamp],
                 india_dates: pd.DatetimeIndex):
        self.cfg = cfg
        self.s = cfg["settings"]
        self.markets = cfg["markets"]
        self.logret = logret
        self.market_of = market_of
        self.window = window
        self.india_dates = india_dates
        self.hist_start = pd.Timestamp(self.s.get("history_start", "2015-01-01"))
        self.diag = {"zero_days": 0, "accumulated_days": 0}
        self._cache: dict[tuple[str, str], pd.Series] = {}

    def mkt(self, t: str) -> dict[str, Any]:
        return self.markets[self.market_of(t)]

    def aligned(self, source: str, target_dates: pd.DatetimeIndex, target_market: str, key: str) -> pd.Series | None:
        ck = (source, key)
        if ck in self._cache:
            return self._cache[ck]
        r = self.logret(source)
        if r is None:
            return None
        x, diag = align_series(target_dates, self.markets[target_market], r, self.mkt(source))
        if source == "^SOX" and key == "IN":
            self.diag = diag
        self._cache[ck] = x
        return x

    def target_frame(self, ticker: str, parent: str | None) -> pd.DataFrame | None:
        r = self.logret(ticker)
        if r is None or r.empty:
            return None
        r = r[r.index >= self.hist_start - pd.Timedelta(days=400)]
        tm = self.market_of(ticker)
        dates = pd.DatetimeIndex(r.index)
        key = f"{ticker}"
        cols = {"y": r}
        for name, src in (("SOX", "^SOX"), ("NDX", "^NDX"), ("NIFTY", "^NSEI")):
            if src == ticker:
                return None
            x = self.aligned(src, dates, tm, key)
            if x is None:
                return None
            cols[name] = x
        if parent:
            xp = self.aligned(parent, dates, tm, key)
            if xp is not None:
                # parent returns before the parent's first close are unknown, not zero
                pr = self.logret(parent)
                first = pr.index[0] if pr is not None and not pr.empty else None
                if first is not None:
                    xp = xp.where(dates > first)
                cols["PARENT"] = xp
        df = pd.DataFrame(cols)
        return df

    def in_window(self, df: pd.DataFrame) -> pd.DataFrame:
        a, b = self.window
        return df[(df.index >= a) & (df.index <= b)]


def _cols(df: pd.DataFrame, with_parent: bool) -> list[str]:
    cols = ["SOX", "NDX"]
    if with_parent and "PARENT" in df.columns:
        cols.append("PARENT")
    cols.append("NIFTY")
    return cols


def nifty_model(est: Estimator) -> dict[str, Any]:
    dates = est.india_dates[est.india_dates >= est.hist_start - pd.Timedelta(days=400)]
    r = est.logret("^NSEI").reindex(dates)
    x_sox = est.aligned("^SOX", dates, "IN", "IN")
    x_ndx = est.aligned("^NDX", dates, "IN", "IN")
    df = pd.DataFrame({"y": r, "SOX": x_sox, "NDX": x_ndx})
    w = est.in_window(df)
    hac = int(est.s.get("hac_lags", 5))
    main = stats.ols(w["y"], w[["SOX", "NDX"]], hac, SPEC_NIFTY)
    m = stats.downside_mask(w["SOX"], float(est.s.get("downside_quantile", 0.05)))
    down = stats.ols(w.loc[m, "y"], w.loc[m, ["SOX", "NDX"]], hac, SPEC_NIFTY + "  [x_SOX <= q05]") if m.sum() >= int(est.s.get("downside_min_obs", 25)) else None
    return {"main": main, "down": down, "frame": df}


def target_model(est: Estimator, ticker: str, parent: str | None, nifty: dict[str, Any]) -> dict[str, Any]:
    s = est.s
    hac = int(s.get("hac_lags", 5))
    q = float(s.get("downside_quantile", 0.05))
    dmin = int(s.get("downside_min_obs", 25))
    df = est.target_frame(ticker, parent)
    out: dict[str, Any] = {"reg": None, "reg_down": None, "rolling": None, "resid": None,
                           "slopes": {"ndx_on_sox": None, "parent_on_sox": None, "ndx_on_sox_down": None, "parent_on_sox_down": None},
                           "beta_total": None, "beta_total_down": None, "n_window": 0, "frame": df}
    if df is None:
        return out
    with_parent = "PARENT" in df.columns and df["PARENT"].notna().sum() > 30
    cols = _cols(df, with_parent)
    spec = SPEC_MAIN if with_parent else SPEC_MAIN_NOP
    if est.market_of(ticker) == "US":
        spec += "  [US-listed: factors enter same-day under the information-set rule]"
    w = est.in_window(df)
    out["n_window"] = int(w["y"].notna().sum())
    reg = stats.ols(w["y"], w[cols], hac, spec)
    out["reg"] = reg
    m = stats.downside_mask(w["SOX"], q)
    if m.sum() >= dmin:
        out["reg_down"] = stats.ols(w.loc[m, "y"], w.loc[m, cols], hac, spec + "  [x_SOX <= q05]")
    sl = out["slopes"]
    sl["ndx_on_sox"] = stats.slope(w["NDX"], w["SOX"])
    sl["ndx_on_sox_down"] = stats.slope(w.loc[m, "NDX"], w.loc[m, "SOX"]) if m.sum() >= dmin else None
    if with_parent:
        sl["parent_on_sox"] = stats.slope(w["PARENT"], w["SOX"])
        sl["parent_on_sox_down"] = stats.slope(w.loc[m, "PARENT"], w.loc[m, "SOX"]) if m.sum() >= dmin else None
    nm, nd = nifty["main"], nifty["down"]
    if reg is not None and nm is not None:
        out["beta_total"] = stats.beta_total(reg["coef"], sl["ndx_on_sox"], sl["parent_on_sox"],
                                             nm["coef"]["SOX"]["b"], nm["coef"]["NDX"]["b"])
    if out["reg_down"] is not None:
        nn = nd if nd is not None else nm
        out["beta_total_down"] = stats.beta_total(out["reg_down"]["coef"], sl["ndx_on_sox_down"], sl["parent_on_sox_down"],
                                                  nn["coef"]["SOX"]["b"], nn["coef"]["NDX"]["b"])
    roll = stats.rolling_ols(df["y"], df[cols], int(s.get("rolling_window", 252)), int(s.get("rolling_step", 5)),
                             int(s.get("rolling_min_obs", 200)), start=est.hist_start)
    out["rolling"] = {
        "dates": roll["dates"],
        "SOX": roll.get("SOX", []),
        "NDX": roll.get("NDX", []),
        "PARENT": roll.get("PARENT") if with_parent else None,
        "NIFTY": roll.get("NIFTY", []),
        "r2": roll["r2"],
    }
    if reg is not None:
        out["resid"] = reg["_resid"]
    return out


def heatmap(est: Estimator, targets: list[str], origins: list[str], frames: dict[str, pd.DataFrame | None]) -> list[list[dict[str, Any]]]:
    hac = int(est.s.get("hac_lags", 5))
    cells: list[list[dict[str, Any]]] = []
    for t in targets:
        row = []
        df = frames.get(t)
        if df is None:
            cells.append([{"beta": None, "t": None, "corr": None} for _ in origins])
            continue
        w = est.in_window(df)
        dates = pd.DatetimeIndex(df.index)
        tm = est.market_of(t)
        for o in origins:
            x = est.aligned(o, dates, tm, t)
            if x is None:
                row.append({"beta": None, "t": None, "corr": None})
                continue
            xw = x.reindex(w.index)
            reg = stats.ols(w["y"], pd.DataFrame({"X": xw}), hac, "univariate")
            if reg is None:
                row.append({"beta": None, "t": None, "corr": None})
            else:
                row.append({"beta": reg["coef"]["X"]["b"], "t": reg["coef"]["X"]["t"], "corr": stats.corr(w["y"], xw)})
        cells.append(row)
    return cells


def peer_betas(returns: dict[str, pd.Series], start: pd.Timestamp, end: pd.Timestamp) -> dict[str, dict[str, float]]:
    """beta[k][j] = cov(r_k, r_j) / var(r_j), same-day, pairwise-complete over [start, end]."""
    df = pd.DataFrame({k: v for k, v in returns.items() if v is not None})
    df = df[(df.index >= start) & (df.index <= end)]
    out: dict[str, dict[str, float]] = {}
    cols = list(df.columns)
    vals = {c: df[c] for c in cols}
    for k in cols:
        out[k] = {}
        for j in cols:
            if j == k:
                out[k][j] = 1.0
                continue
            pair = pd.concat([vals[k], vals[j]], axis=1).dropna()
            if len(pair) < 60:
                continue
            vj = float(np.var(pair.iloc[:, 1].to_numpy()))
            if vj <= 0:
                continue
            cv = float(np.cov(pair.iloc[:, 0].to_numpy(), pair.iloc[:, 1].to_numpy(), bias=True)[0, 1])
            out[k][j] = round(cv / vj, 6)
    return out


def basket_map(index_ret: pd.Series, member_simple: dict[str, pd.Series], weights: dict[str, float],
               start: pd.Timestamp, end: pd.Timestamp) -> dict[str, Any]:
    """Regress index log return on ln(1 + cap-weighted simple basket return) (same-day)."""
    df = pd.DataFrame(member_simple)
    df = df[(df.index >= start) & (df.index <= end)]
    w = pd.Series({k: weights.get(k, 0.0) for k in df.columns}, dtype=float)
    avail = df.notna().astype(float).mul(w, axis=1)
    num = df.fillna(0.0).mul(w, axis=1).sum(axis=1)
    den = avail.sum(axis=1)
    basket = (num / den).where(den > 0)
    xb = np.log1p(basket)
    y = index_ret.reindex(xb.index)
    reg = stats.ols(y, pd.DataFrame({"B": xb}), 5, "index on basket")
    if reg is None:
        return {"beta": 1.0, "r2": 0.0, "n": 0}
    return {"beta": reg["coef"]["B"]["b"], "r2": reg["r2"], "n": reg["n"]}


def parent_map(est: Estimator, parent: str) -> dict[str, Any] | None:
    """Dimson betas of a parent's own-calendar return on SOX and NDX (aligned + one-step lead)."""
    r = est.logret(parent)
    if r is None or r.empty:
        return None
    pm = est.market_of(parent)
    dates = pd.DatetimeIndex(r.index)
    cols = {"y": r}
    for name, src in (("SOX", "^SOX"), ("NDX", "^NDX")):
        if src == parent:
            return None
        x = est.aligned(src, dates, pm, f"P:{parent}")
        if x is None:
            return None
        cols[name + "0"] = x
        cols[name + "1"] = x.shift(-1)  # next parent day's aligned US return (captures overlap)
    df = pd.DataFrame(cols)
    a, b = est.window
    df = df[(df.index >= a) & (df.index <= b)]
    reg = stats.ols(df["y"], df[["SOX0", "SOX1", "NDX0", "NDX1"]], int(est.s.get("hac_lags", 5)), "Dimson")
    if reg is None:
        return None
    c = reg["coef"]
    return {"SOX": c["SOX0"]["b"] + c["SOX1"]["b"], "NDX": c["NDX0"]["b"] + c["NDX1"]["b"], "r2": reg["r2"],
            "n": reg["n"], "method": "Dimson (aligned + 1 lead) on own calendar, 3y window"}
