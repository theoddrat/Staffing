"""Regression utilities: OLS with HAC t-stats, downside subsets, rolling windows, beta_total."""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm


def _f(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def ols(y: pd.Series, X: pd.DataFrame, hac_lags: int = 5, spec: str = "") -> dict[str, Any] | None:
    """OLS of y on X (+const). Coefficients with OLS se and HAC (Newey-West) t / p.

    Returns a RegressionResult-shaped dict plus private keys `_resid` (Series) and `_fitted`.
    """
    df = pd.concat([y.rename("__y"), X], axis=1).dropna()
    k = X.shape[1]
    if len(df) < max(10, k + 3):
        return None
    yy = df["__y"].to_numpy(dtype=float)
    XX = sm.add_constant(df[list(X.columns)].to_numpy(dtype=float), has_constant="add")
    model = sm.OLS(yy, XX)
    res = model.fit()
    try:
        hac = model.fit(cov_type="HAC", cov_kwds={"maxlags": hac_lags})
        t_vals, p_vals = hac.tvalues, hac.pvalues
    except Exception:  # noqa: BLE001 - degenerate design
        t_vals, p_vals = res.tvalues, res.pvalues
    names = ["const"] + list(X.columns)
    coef = {}
    for i, name in enumerate(names):
        coef[name] = {
            "b": _f(res.params[i]) or 0.0,
            "se": _f(res.bse[i]) or 0.0,
            "t": _f(t_vals[i]) or 0.0,
            "p": _f(p_vals[i]) if _f(p_vals[i]) is not None else 1.0,
        }
    resid = pd.Series(res.resid, index=df.index)
    return {
        "spec": spec,
        "n": int(len(df)),
        "start": df.index[0].strftime("%Y-%m-%d"),
        "end": df.index[-1].strftime("%Y-%m-%d"),
        "coef": coef,
        "r2": _f(res.rsquared) or 0.0,
        "adj_r2": _f(res.rsquared_adj) or 0.0,
        "resid_sd": _f(np.std(res.resid, ddof=k + 1)) or 0.0,
        "_resid": resid,
    }


def public(reg: dict[str, Any] | None) -> dict[str, Any] | None:
    """Strip private keys before export."""
    if reg is None:
        return None
    return {k: v for k, v in reg.items() if not k.startswith("_")}


def slope(y: pd.Series, x: pd.Series) -> float | None:
    """Simple OLS slope of y on x (with intercept)."""
    df = pd.concat([y, x], axis=1).dropna()
    if len(df) < 10:
        return None
    xv = df.iloc[:, 1].to_numpy(dtype=float)
    yv = df.iloc[:, 0].to_numpy(dtype=float)
    vx = np.var(xv)
    if vx <= 0:
        return None
    return float(np.cov(yv, xv, bias=True)[0, 1] / vx)


def corr(y: pd.Series, x: pd.Series) -> float | None:
    df = pd.concat([y, x], axis=1).dropna()
    if len(df) < 10:
        return None
    c = np.corrcoef(df.iloc[:, 0].to_numpy(dtype=float), df.iloc[:, 1].to_numpy(dtype=float))[0, 1]
    return _f(c)


def downside_mask(x: pd.Series, q: float) -> pd.Series:
    """Boolean mask of days where x is at or below its q-quantile (worst q share of days)."""
    xs = x.dropna()
    if xs.empty:
        return pd.Series(False, index=x.index)
    thr = float(np.quantile(xs.to_numpy(), q))
    return (x <= thr) & x.notna()


def rolling_ols(
    y: pd.Series,
    X: pd.DataFrame,
    window: int,
    step: int,
    min_obs: int,
    start: pd.Timestamp | None = None,
) -> dict[str, Any]:
    """Rolling OLS over the last `window` rows ending at every `step`-th row.

    Rows with NaN are dropped inside each window; windows with < min_obs valid rows -> None.
    Returns {dates, <col>: [...], r2: [...]}.
    """
    df = pd.concat([y.rename("__y"), X], axis=1)
    if start is not None:
        df = df[df.index >= start - pd.Timedelta(days=int(window * 1.6))]
    cols = list(X.columns)
    out: dict[str, list] = {"dates": [], "r2": []}
    for c in cols:
        out[c] = []
    n = len(df)
    if n == 0:
        return out
    yv = df["__y"].to_numpy(dtype=float)
    Xv = df[cols].to_numpy(dtype=float)
    ends = list(range(window - 1, n, step))
    if ends and ends[-1] != n - 1:
        ends.append(n - 1)
    for e in ends:
        s = max(0, e - window + 1)
        ys = yv[s : e + 1]
        Xs = Xv[s : e + 1]
        ok = np.isfinite(ys) & np.all(np.isfinite(Xs), axis=1)
        date = df.index[e]
        if start is not None and date < start:
            continue
        out["dates"].append(date.strftime("%Y-%m-%d"))
        if ok.sum() < min_obs:
            for c in cols:
                out[c].append(None)
            out["r2"].append(None)
            continue
        A = np.column_stack([np.ones(ok.sum()), Xs[ok]])
        b, *_ = np.linalg.lstsq(A, ys[ok], rcond=None)
        fitted = A @ b
        ss_res = float(np.sum((ys[ok] - fitted) ** 2))
        ss_tot = float(np.sum((ys[ok] - ys[ok].mean()) ** 2))
        for i, c in enumerate(cols):
            out[c].append(_f(b[i + 1]))
        out["r2"].append(_f(1 - ss_res / ss_tot) if ss_tot > 0 else None)
    return out


def beta_total(coef: dict[str, dict[str, float]], m_ndx_sox: float | None, m_p_sox: float | None,
               c_sox: float, c_ndx: float) -> float | None:
    """beta_total = b_SOX + b_NDX m_NDX|SOX + b_P m_P|SOX + b_N (c_SOX + c_NDX m_NDX|SOX)."""
    if "SOX" not in coef:
        return None
    m_ndx = m_ndx_sox or 0.0
    b = coef["SOX"]["b"]
    b += coef.get("NDX", {}).get("b", 0.0) * m_ndx
    if "PARENT" in coef:
        b += coef["PARENT"]["b"] * (m_p_sox or 0.0)
    if "NIFTY" in coef:
        b += coef["NIFTY"]["b"] * (c_sox + c_ndx * m_ndx)
    return _f(b)
