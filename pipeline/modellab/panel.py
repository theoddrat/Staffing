"""Assemble the lab's panel: every target's log returns and aligned signals on the India session calendar.

Rows are NSE sessions (the ^NSEI calendar); columns are targets. A target listed outside India (e.g. SIFY
on NASDAQ) keeps its own-calendar alignment and is mapped to the India session in which its close becomes
known (information-set rule), accumulating when several of its sessions fall into one India session.
If the latest US close is newer than the latest NSE close, one extra row is appended for the next NSE
session (no actual yet) so the lab can produce tomorrow's nowcast.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd

from pipeline.align import align_series, close_timestamps

def ns(x: pd.DatetimeIndex | pd.Timestamp | str) -> np.ndarray | int:
    """Nanosecond integers whatever the datetime unit (pandas 3 indexes are often microsecond-based)."""
    if isinstance(x, pd.DatetimeIndex):
        return x.as_unit("ns").asi8
    return int(pd.Timestamp(x).as_unit("ns").value)


BASE_FEATS = ["SOX", "NDX", "PARENT", "NIFTY", "SOX_L1", "NDX_L1", "PARENT_L1", "NIFTY_L1", "Y_L1", "SOXn", "NDXn", "ADR",
              "NIFTY_L2", "Y_L2", "ADR_L1", "GAP", "GAP_L1"]
# Signals of the previous session that are still informative for the next one (all known before the NSE open).
LAG_OF = {"INDA_L1": "INDA", "EPI_L1": "EPI", "SMIN_L1": "SMIN", "ADR_L1": "ADR", "NIFTY_L2": "NIFTY_L1", "Y_L2": "Y_L1", "GAP_L1": "GAP"}


@dataclass
class Panel:
    dates: pd.DatetimeIndex
    n_data: int
    tickers: list[str]
    display: list[str]
    tiers: np.ndarray
    markets: list[str]
    parents: list[str | None]
    adrs: list[str | None]
    Y: np.ndarray
    F: dict[str, np.ndarray]
    nifty: dict[str, np.ndarray]
    aux_ids: list[str]
    same_day_feats: set[str]
    parent_same_day: np.ndarray
    in_close: pd.DatetimeIndex
    us_dates: pd.DatetimeIndex
    us_j: np.ndarray
    future: bool = False
    future_same_day_ready: bool = True
    info: dict[str, Any] = field(default_factory=dict)

    @property
    def T(self) -> int:
        return len(self.dates)

    @property
    def N(self) -> int:
        return len(self.tickers)

    def india_row_of_us(self, us_date: str | pd.Timestamp) -> int | None:
        """India row in which the US close of `us_date` becomes known (None if beyond the panel)."""
        d = pd.Timestamp(us_date)
        k = int(np.searchsorted(ns(self.us_dates), ns(d)))
        if k >= len(self.us_dates) or self.us_dates[k] != d:
            return None
        j = int(self.us_j[k])
        return j if j < self.T else None

    def last_us_date_of_row(self, t: int) -> pd.Timestamp | None:
        k = np.nonzero(self.us_j == t)[0]
        return self.us_dates[k[-1]] if len(k) else None


def same_day_markets(markets: dict[str, Any], ref_date: pd.Timestamp) -> set[str]:
    """Markets whose close falls before the NSE close on the same date (their move is known the same day)."""
    in_c = close_timestamps([ref_date], markets["IN"])[0]
    return {m for m, spec in markets.items() if close_timestamps([ref_date], spec)[0] < in_c}


def build_panel(cfg: dict[str, Any], ctx: Any, est: Any, nm: dict[str, Any], log: Callable[[str], None] = print) -> Panel:
    markets = cfg["markets"]
    IN = markets["IN"]
    start = est.hist_start - pd.Timedelta(days=400)
    D0 = ctx.india_dates[ctx.india_dates >= start]
    sox = ctx.logret("^SOX")
    ndx = ctx.logret("^NDX")
    us_mk = markets[ctx.market_of("^SOX")]
    in_close0 = close_timestamps(D0, IN)
    future = bool(close_timestamps([sox.index[-1]], us_mk)[0] > in_close0[-1])
    D = D0.append(pd.DatetimeIndex([(D0[-1] + pd.offsets.BDay(1)).normalize()]).as_unit(D0.unit)) if future else D0
    n_data, T = len(D0), len(D)
    in_close = close_timestamps(D, IN)
    sd_mk = same_day_markets(markets, D[n_data - 1])

    # ---- auxiliary signals (verified: dropped and logged when Yahoo has no usable history)
    aux_series: dict[str, tuple[pd.Series, str]] = {}
    aux_log: list[dict[str, Any]] = []
    for a in cfg.get("factors_aux", []) or []:
        tk = a["ticker"]
        if a.get("kind", "return") == "change":
            df = ctx.prices(tk)
            s = df["Close"].astype(float).diff().dropna() if df is not None and len(df) > 1 else None
        else:
            s = ctx.logret(tk)
        if s is None or len(s) < 300:
            log(f"[modellab] aux factor {a['id']} ({tk}) unavailable — dropped")
            aux_log.append({"id": a["id"], "ticker": tk, "ok": False})
            continue
        aux_series[a["id"]] = (s, a["market"])
        aux_log.append({"id": a["id"], "ticker": tk, "ok": True, "n": int(len(s)),
                        "first": s.index[0].strftime("%Y-%m-%d"), "last": s.index[-1].strftime("%Y-%m-%d")})

    def on_D(series: pd.Series, mk: str) -> np.ndarray:
        return align_series(D, IN, series, markets[mk])[0].to_numpy(dtype=float).copy()

    common = {"SOX": on_D(sox, ctx.market_of("^SOX")), "NDX": on_D(ndx, ctx.market_of("^NDX"))}
    for aid, (s, mk) in aux_series.items():
        common[aid] = on_D(s, mk)

    targets = cfg["india"]
    N = len(targets)
    feats = BASE_FEATS + list(aux_series) + [k for k, v in LAG_OF.items() if v in aux_series]

    def _derive(df: pd.DataFrame) -> None:
        """ETF gap (US-listed India fund move net of the Nifty session it already contains and of the rupee) + lags."""
        if "INDA" in df.columns and "USDINR" in df.columns:
            df["GAP"] = df["INDA"] - df["NIFTY_L1"] + df["USDINR"]
        for lg, src in LAG_OF.items():
            if src in df.columns:
                df[lg] = df[src].shift(1)
    Y = np.full((T, N), np.nan)
    F = {k: np.full((T, N), np.nan) for k in feats}
    adrs: list[str | None] = [None] * N
    parents: list[str | None] = [None] * N
    psd = np.zeros(N, dtype=bool)
    tickers, display, tiers, mkts = [], [], [], []
    for i, t in enumerate(targets):
        tk, parent = t["ticker"], t.get("parent")
        tickers.append(tk)
        display.append(t.get("display", tk))
        tiers.append(t["tier"])
        tm = ctx.market_of(tk)
        mkts.append(tm)
        fr = est.target_frame(tk, parent)
        if fr is None or fr.empty:
            log(f"[modellab] {tk}: no target frame — skipped")
            continue
        own = pd.DatetimeIndex(fr.index)
        df = pd.DataFrame({"y": fr["y"], "SOX": fr["SOX"], "NDX": fr["NDX"], "NIFTY": fr["NIFTY"]})
        if "PARENT" in fr.columns:
            df["PARENT"] = fr["PARENT"]
            df["PARENT_L1"] = df["PARENT"].shift(1)
            parents[i] = parent
            psd[i] = ctx.market_of(parent) in sd_mk
        df["Y_L1"] = df["y"].shift(1)
        df["SOX_L1"] = df["SOX"].shift(1)
        df["NDX_L1"] = df["NDX"].shift(1)
        df["NIFTY_L1"] = df["NIFTY"].shift(1)
        if tm == "IN":
            df["SOXn"], df["NDXn"] = df["SOX"], df["NDX"]
        else:  # the Nifty session a US-listed close is paired with reacted to the previous US session
            df["SOXn"], df["NDXn"] = df["SOX_L1"], df["NDX_L1"]
        for aid, (s, mk) in aux_series.items():
            df[aid] = align_series(own, markets[tm], s, markets[mk])[0]
        adr = t.get("adr")
        adr_ret = ctx.logret(adr) if adr else None
        if adr_ret is not None and len(adr_ret) > 300:
            df["ADR"] = align_series(own, markets[tm], adr_ret, markets[ctx.market_of(adr)])[0]
            adrs[i] = adr
        _derive(df)
        if tm == "IN":
            j = D[:n_data].get_indexer(own)
        else:
            j = np.searchsorted(ns(in_close[:n_data]), ns(close_timestamps(own, markets[tm])), side="left")
        keep = (j >= 0) & (j < n_data)
        sub = df[keep].copy()
        sub["_j"] = j[keep]
        sub = sub.groupby("_j").sum(min_count=1) if sub["_j"].duplicated().any() else sub.set_index("_j")
        jj = sub.index.to_numpy(dtype=int)
        Y[jj, i] = sub["y"].to_numpy(dtype=float)
        for k in feats:
            if k in sub.columns:
                F[k][jj, i] = sub[k].to_numpy(dtype=float)
        if future and tm == "IN" and len(own) and own[-1] == D[n_data - 1]:
            r = T - 1
            for k in ("SOX", "NDX", *aux_series):
                F[k][r, i] = common[k][r]
            F["SOXn"][r, i], F["NDXn"][r, i] = common["SOX"][r], common["NDX"][r]
            if parents[i]:
                F["PARENT"][r, i] = on_D(ctx.logret(parent), ctx.market_of(parent))[r]
                F["PARENT_L1"][r, i] = F["PARENT"][r - 1, i]
            if adrs[i]:
                F["ADR"][r, i] = on_D(adr_ret, ctx.market_of(adr))[r]
            F["SOX_L1"][r, i], F["NDX_L1"][r, i] = F["SOX"][r - 1, i], F["NDX"][r - 1, i]
            F["Y_L1"][r, i], F["NIFTY_L1"][r, i] = Y[r - 1, i], F["NIFTY"][r - 1, i]
            if "INDA" in F and "USDINR" in F:
                F["GAP"][r, i] = F["INDA"][r, i] - F["NIFTY_L1"][r, i] + F["USDINR"][r, i]
            for lg, src in LAG_OF.items():
                if lg in F and src in F:
                    F[lg][r, i] = F[src][r - 1, i]

    ny = nm["frame"]["y"].reindex(D).to_numpy(dtype=float).copy()
    if future:
        ny[-1] = np.nan
    nifty = {"y": ny, "SOX": common["SOX"], "NDX": common["NDX"], "NIFTY_L1": np.r_[np.nan, ny[:-1]]}
    for aid in aux_series:
        nifty[aid] = common[aid]
    nf = pd.DataFrame(nifty)
    _derive(nf)
    for k in nf.columns:
        nifty[k] = nf[k].to_numpy(dtype=float).copy()

    us_dates = pd.DatetimeIndex(sox.index)
    us_j = np.searchsorted(ns(in_close), ns(close_timestamps(us_dates, us_mk)), side="left")
    same_day_feats = {aid for aid, (_, mk) in aux_series.items() if mk in sd_mk}
    ready = True
    if future:
        # same-day (Asian) signals count only if their close for that session is actually in the data: in-progress
        # bars were already dropped by the price layer, and a missing bar must not be read as "no move"
        srcs = [s for s, mk in aux_series.values() if mk in sd_mk]
        srcs += [ctx.logret(p) for p in dict.fromkeys(parents) if p and ctx.market_of(p) in sd_mk]
        ready = all(s is not None and D[-1] in s.index for s in srcs)
    return Panel(dates=D, n_data=n_data, tickers=tickers, display=display, tiers=np.array(tiers), markets=mkts,
                 parents=parents, adrs=adrs, Y=Y, F=F, nifty=nifty, aux_ids=list(aux_series),
                 same_day_feats=same_day_feats, parent_same_day=psd, in_close=in_close, us_dates=us_dates,
                 us_j=us_j, future=future, future_same_day_ready=ready,
                 info={"aux": aux_log, "same_day_markets": sorted(sd_mk), "aux_markets": {a: mk for a, (_, mk) in aux_series.items()}})
