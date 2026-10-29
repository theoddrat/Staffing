"""Small dense solvers for the walk-forward lab (numpy/scipy only; no statsmodels in the hot loop)."""
from __future__ import annotations

import numpy as np
from scipy.optimize import nnls


def lstsq(X: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> np.ndarray:
    """(Weighted) least squares coefficients."""
    if w is not None:
        sw = np.sqrt(w)
        return np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)[0]
    return np.linalg.lstsq(X, y, rcond=None)[0]


def ols(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """OLS coefficients, classical standard errors and residual sd (ddof = k)."""
    b = lstsq(X, y)
    r = y - X @ b
    n, k = X.shape
    s2 = float(r @ r) / max(n - k, 1)
    inv = np.linalg.pinv(X.T @ X)
    se = np.sqrt(np.maximum(np.diag(inv) * s2, 0.0))
    return b, se, float(np.sqrt(s2))


def huber(X: np.ndarray, y: np.ndarray, c: float, max_iter: int) -> np.ndarray:
    """Huber M-estimator by IRLS with the MAD scale re-estimated each iteration (as statsmodels RLM/HuberT)."""
    b = lstsq(X, y)
    for _ in range(max_iter):
        r = y - X @ b
        s = float(np.median(np.abs(r - np.median(r)))) / 0.6744897501960817
        if not np.isfinite(s) or s <= 0:
            break
        u = np.abs(r) / s
        w = np.where(u <= c, 1.0, c / np.maximum(u, 1e-300))
        b_new = lstsq(X, y, w)
        if np.max(np.abs(b_new - b)) <= 1e-10 * (1.0 + np.max(np.abs(b))):
            return b_new
        b = b_new
    return b


def ridge_path(Xs: np.ndarray, yc: np.ndarray, lambdas: list[float] | np.ndarray) -> np.ndarray:
    """Ridge coefficients (k x L) for min (1/n)||yc - Xs b||^2 + lam ||b||^2 (Xs standardised, yc centred)."""
    n = len(yc)
    A = Xs.T @ Xs / n
    c = Xs.T @ yc / n
    d, V = np.linalg.eigh(A)
    lam = np.asarray(lambdas, dtype=float)
    return V @ ((V.T @ c)[:, None] / (np.maximum(d, 0.0)[:, None] + lam[None, :]))


def simplex_weights(G: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Stacking weights: min w'Gw - 2c'w subject to w >= 0 and sum(w) <= 1.

    G = P'P and c = P'y from out-of-sample component predictions P. The remainder 1 - sum(w) is the
    weight on the zero forecast, so the full weight vector (components + zero) is non-negative and
    sums to one. Solved exactly with NNLS on a Cholesky factor; if the unconstrained-sum NNLS weights
    exceed one, the sum = 1 constraint is imposed through a heavily weighted extra row.
    """
    m = len(c)
    scale = float(np.trace(G)) / m
    if not np.isfinite(scale) or scale <= 0:
        return np.full(m, 1.0 / m)
    Gs = G / scale + 1e-10 * np.eye(m)
    cs = c / scale
    L = np.linalg.cholesky(Gs)
    A = L.T
    b = np.linalg.solve(L, cs)
    w, _ = nnls(A, b, maxiter=50 * m)
    if w.sum() <= 1.0 + 1e-12:
        return w
    M = 1e4 * max(1.0, float(np.max(np.abs(A))))
    w, _ = nnls(np.vstack([A, np.full((1, m), M)]), np.append(b, M), maxiter=50 * m)
    s = w.sum()
    return w / s if s > 0 else np.full(m, 1.0 / m)


def eb_shrink(b: np.ndarray, se: np.ndarray, groups: np.ndarray, floor: float, min_group: int) -> np.ndarray:
    """Empirical-Bayes shrinkage toward the group mean: b~ = w b + (1 - w) bbar, w = tau2 / (tau2 + se^2).

    tau2 (between-stock variance of the true coefficient) = max(var(b) - mean(se^2), floor * mean(se^2)).
    Groups with fewer than `min_group` estimates shrink toward the pool of all stocks instead.
    """
    out = b.astype(float).copy()
    ok = np.isfinite(b) & np.isfinite(se) & (se > 0)
    if ok.sum() < min_group:
        return out
    for g in np.unique(groups[ok]):
        sel = ok & (groups == g)
        pool = sel if sel.sum() >= min_group else ok
        bbar = float(np.mean(b[pool]))
        s2 = float(np.mean(se[pool] ** 2))
        tau2 = max(float(np.var(b[pool], ddof=1)) - s2, floor * s2)
        w = tau2 / (tau2 + se[sel] ** 2)
        out[sel] = w * b[sel] + (1.0 - w) * bbar
    return out


def slope(y: np.ndarray, x: np.ndarray) -> float | None:
    m = np.isfinite(y) & np.isfinite(x)
    if m.sum() < 10:
        return None
    xv, yv = x[m], y[m]
    vx = float(np.var(xv))
    if vx <= 0:
        return None
    return float(np.mean((xv - xv.mean()) * (yv - yv.mean())) / vx)
