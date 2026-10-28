"""Calendar alignment: the information-set rule behind the "US t-1 lag" (DESIGN.md §3.2)."""
import numpy as np
import pandas as pd
import pytest

from pipeline.align import align_returns, align_series, close_timestamps
from tests.conftest import MARKETS

IN, US, JP, DE = MARKETS["IN"], MARKETS["US"], MARKETS["JP"], MARKETS["DE"]


def _series(dates, values):
    return pd.Series(values, index=pd.DatetimeIndex(pd.to_datetime(dates)), dtype=float)


def test_us_return_enters_next_india_day():
    # One normal week, both markets open Mon..Fri. US close (20:00 UTC) is after NSE close (10:00 UTC).
    days = pd.bdate_range("2026-06-01", "2026-06-12")  # Mon 1 Jun .. Fri 12 Jun
    us = _series(days, np.arange(1, len(days) + 1) / 100.0)
    x, diag = align_series(days, IN, us, US)
    assert np.isnan(x.iloc[0])  # first India day has no defined interval
    # India day t gets the US return of the previous US session (t-1); Monday gets Friday.
    for i in range(1, len(days)):
        assert x.iloc[i] == pytest.approx(us.iloc[i - 1])
    assert diag["zero_days"] == 0 and diag["accumulated_days"] == 0


def test_us_holiday_gives_zero_for_next_india_day():
    india = pd.DatetimeIndex(["2026-01-16", "2026-01-19", "2026-01-20", "2026-01-21"])  # Fri, Mon, Tue, Wed
    us_days = ["2026-01-15", "2026-01-16", "2026-01-20", "2026-01-21"]  # US closed Mon 19-Jan (MLK day)
    us = _series(us_days, [0.01, 0.02, 0.03, 0.04])
    x, diag = align_series(india, IN, us, US)
    assert x.loc["2026-01-19"] == pytest.approx(0.02)  # India Mon <- US Fri
    assert x.loc["2026-01-20"] == 0.0  # US holiday Monday: no new US close before India Tue close
    assert x.loc["2026-01-21"] == pytest.approx(0.03)  # India Wed <- US Tue
    assert diag["zero_days"] == 1


def test_india_holiday_accumulates_us_returns():
    india = pd.DatetimeIndex(["2026-03-02", "2026-03-03", "2026-03-05"])  # Mon, Tue, (Wed holiday), Thu
    us = _series(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"], [0.01, -0.02, -0.03, 0.05])
    x, diag = align_series(india, IN, us, US)
    assert x.loc["2026-03-03"] == pytest.approx(0.01)  # US Mon
    assert x.loc["2026-03-05"] == pytest.approx(-0.02 - 0.03)  # US Tue + US Wed accumulate
    assert diag["accumulated_days"] == 1


def test_tokyo_enters_same_india_day():
    days = pd.bdate_range("2026-06-01", "2026-06-05")
    jp = _series(days, [0.01, 0.02, 0.03, 0.04, 0.05])
    x, _ = align_series(days, IN, jp, JP)
    # Tokyo closes 15:30 JST = 12:00 IST, before the NSE close -> same-day information
    assert list(x.iloc[1:]) == pytest.approx([0.02, 0.03, 0.04, 0.05])


def test_tokyo_close_time_change_2024():
    ts = close_timestamps(["2024-11-01", "2024-11-05"], JP)
    assert ts[0] == pd.Timestamp("2024-11-01 06:00", tz="UTC")  # 15:00 JST before 5-Nov-2024
    assert ts[1] == pd.Timestamp("2024-11-05 06:30", tz="UTC")  # 15:30 JST from 5-Nov-2024


def test_dst_edges_keep_ordering():
    us = close_timestamps(["2026-03-06", "2026-03-09"], US)  # US DST starts 8-Mar-2026
    assert us[0] == pd.Timestamp("2026-03-06 21:00", tz="UTC")
    assert us[1] == pd.Timestamp("2026-03-09 20:00", tz="UTC")
    de = close_timestamps(["2026-03-27", "2026-03-30"], DE)  # EU DST starts 29-Mar-2026
    assert de[0] == pd.Timestamp("2026-03-27 16:30", tz="UTC")
    assert de[1] == pd.Timestamp("2026-03-30 15:30", tz="UTC")
    ind = close_timestamps(["2026-03-06", "2026-03-09"], IN)  # India has no DST
    assert all(t.hour == 10 for t in ind)
    # Across both DST switches the US and European returns still enter the next India day.
    india = pd.bdate_range("2026-03-02", "2026-04-03")
    usr = _series(india, np.linspace(0.001, 0.025, len(india)))
    x, _ = align_series(india, IN, usr, US)
    assert x.iloc[1:].to_numpy() == pytest.approx(usr.iloc[:-1].to_numpy())
    der = _series(india, np.linspace(-0.01, 0.01, len(india)))
    xd, _ = align_series(india, IN, der, DE)
    assert xd.iloc[1:].to_numpy() == pytest.approx(der.iloc[:-1].to_numpy())


def test_us_listed_target_sees_nifty_same_day():
    # SIFY (US-listed): Nifty's close (10:00 UTC) precedes the US close of the same date.
    us_days = pd.bdate_range("2026-06-01", "2026-06-05")
    nifty = _series(us_days, [0.01, 0.02, 0.03, 0.04, 0.05])
    x, _ = align_series(us_days, US, nifty, IN)
    assert list(x.iloc[1:]) == pytest.approx([0.02, 0.03, 0.04, 0.05])


def test_align_returns_validates_inputs():
    t = pd.DatetimeIndex(["2026-01-01 10:00", "2026-01-02 10:00"], tz="UTC")
    with pytest.raises(ValueError):
        align_returns(t, t, [0.1])
    with pytest.raises(ValueError):
        align_returns(t[::-1], t, [0.1, 0.2])
