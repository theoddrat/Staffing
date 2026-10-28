"""Interface between the core pipeline (DATA-CORE) and the history module (DATA-HISTORY).

DATA-CORE builds a concrete `BuildContext` and calls

    from pipeline.history import build_history
    history_section, calibration_partial, extra_sources = build_history(ctx)

* `history_section` -> data.json["history"] (see src/types/data.ts `DataBundle.history`).
* `calibration_partial` -> merged into data.json["calibration"]; must contain
  `contagion_us` and `contagion_india` Quantity dicts.
* `extra_sources` -> list of Source dicts (src/types/data.ts `Source`) cited by history items;
  DATA-CORE de-duplicates by id and appends them to data.json["sources"].

History config lives in `history.yaml` (included from universe.yaml via `includes:`) and is
available as `ctx.cfg["history"]` (cases, event_studies, pe_points, overlay, worst_windows ...).
Replay windows live in universe.yaml (`ctx.cfg["replay_windows"]`) but their moves are computed by
`build_history` (it returns them in `history_section["replay_windows"]`).
"""
from __future__ import annotations

from typing import Any, Protocol

import pandas as pd


class BuildContext(Protocol):
    cfg: dict[str, Any]
    """Merged config: universe.yaml + included files (+ research overlay if present)."""

    india_dates: pd.DatetimeIndex
    """All NSE trading dates (from ^NSEI), full available history, ascending."""

    window: tuple[pd.Timestamp, pd.Timestamp]
    """Regression window (start, end) on India dates."""

    targets: list[dict[str, Any]]
    """India targets: dicts with at least ticker, display, name, tier, parent."""

    origins: list[dict[str, Any]]
    """Shock origins: dicts with at least ticker, name, group."""

    securities: dict[str, dict[str, Any]]
    """Computed Security records (src/types/data.ts `Security`), keyed by ticker."""

    usd_inr: float

    def prices(self, ticker: str) -> pd.DataFrame | None:
        """Daily OHLC with Close (split-adj) and AdjClose (split+div adj); DatetimeIndex of local dates."""

    def logret(self, ticker: str) -> pd.Series | None:
        """Daily log returns of AdjClose on the ticker's own calendar."""

    def aligned_to_india(self, ticker: str) -> pd.Series | None:
        """Information-set aligned log returns x_F,t on India dates (DESIGN.md section 3.2)."""

    def source_ids(self) -> set[str]:
        """Ids of all sources known to the core (universe.yaml `sources:`)."""
