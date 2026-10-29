"""Typed view of universe.yaml `modellab:` (every window / half-life / refit setting is declared there)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class LabSettings:
    oos_start: str
    train_sessions: int
    min_train_obs: int
    refit_every: int
    ewma_half_life: float
    huber_c: float
    huber_max_iter: int
    shrink_tau2_floor: float
    shrink_min_group: int
    gbm_enabled: bool
    gbm_refit_every: int
    gbm: dict[str, Any]
    gbm_feature_window: int
    gbm_feature_min_obs: int
    ridge_lambdas: tuple[float, ...]
    ridge_cv_folds: int
    nowcast_train_sessions: int
    stack_min_rows: int
    stack_allow_zero: bool
    band_levels: tuple[float, ...]
    band_min_obs: int
    band_lookback: int
    hit_threshold: float
    shock_quantile: float
    xs_min_stocks: int
    event_min_stocks: int
    final_min_obs: int
    horizons: tuple[int, ...]
    horizon_long_years: int
    horizon_stack_min_blocks: dict[int, int]
    nifty_horizon_min_blocks: dict[int, int]
    settle_minutes: int
    worst_sox_since: str
    worst_sox_n: int
    events: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    @property
    def train_years(self) -> int:
        return round(self.train_sessions / 252)


def from_config(cfg: dict[str, Any]) -> LabSettings:
    m = cfg["modellab"]
    return LabSettings(
        oos_start=str(m["oos_start"]),
        train_sessions=int(m["train_sessions"]),
        min_train_obs=int(m["min_train_obs"]),
        refit_every=int(m["refit_every"]),
        ewma_half_life=float(m["ewma_half_life"]),
        huber_c=float(m["huber_c"]),
        huber_max_iter=int(m["huber_max_iter"]),
        shrink_tau2_floor=float(m["shrink_tau2_floor"]),
        shrink_min_group=int(m["shrink_min_group"]),
        gbm_enabled=bool(m["gbm_enabled"]),
        gbm_refit_every=int(m["gbm_refit_every"]),
        gbm=dict(m["gbm"]),
        gbm_feature_window=int(m["gbm_feature_window"]),
        gbm_feature_min_obs=int(m["gbm_feature_min_obs"]),
        ridge_lambdas=tuple(float(x) for x in m["ridge_lambdas"]),
        ridge_cv_folds=int(m["ridge_cv_folds"]),
        nowcast_train_sessions=int(m["nowcast_train_sessions"]),
        stack_min_rows=int(m["stack_min_rows"]),
        stack_allow_zero=bool(m["stack_allow_zero"]),
        band_levels=tuple(float(x) for x in m["band_levels"]),
        band_min_obs=int(m["band_min_obs"]),
        band_lookback=int(m["band_lookback"]),
        hit_threshold=float(m["hit_threshold"]),
        shock_quantile=float(m["shock_quantile"]),
        xs_min_stocks=int(m["xs_min_stocks"]),
        event_min_stocks=int(m["event_min_stocks"]),
        final_min_obs=int(m["final_min_obs"]),
        horizons=tuple(int(h) for h in m["horizons"]),
        horizon_long_years=int(m["horizon_long_years"]),
        horizon_stack_min_blocks={int(k): int(v) for k, v in m["horizon_stack_min_blocks"].items()},
        nifty_horizon_min_blocks={int(k): int(v) for k, v in m["nifty_horizon_min_blocks"].items()},
        settle_minutes=int(m["settle_minutes"]),
        worst_sox_since=str(m["worst_sox_since"]),
        worst_sox_n=int(m["worst_sox_n"]),
        events=tuple(dict(e) for e in m.get("events", []) or []),
    )


def as_dict(s: LabSettings) -> dict[str, Any]:
    from dataclasses import asdict

    return asdict(s)
