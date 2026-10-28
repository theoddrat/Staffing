// F4 / OVERLAY + DEEPSEEK + CALIBRATION sub-views.
import { useMemo } from 'react';
import type { DataBundle } from '../../../types/data';
import type { ScenarioResult } from '../../../types/engine';
import Chart, { axisStyle, CHART_COLORS } from '../../../components/Chart';
import { SourceLinks, StatusBadge } from '../../../components/StatusBadge';
import { isNum, num, spct } from '../../../lib/format';
import { Empty, MoveCell, Note, Section } from '../common';
import { moveRatio } from '../historyUtil';
import { logToSimple } from '../util';

const OVERLAY_COLORS = [CHART_COLORS.grey, '#c9a0ff', CHART_COLORS.amber, CHART_COLORS.cyan, CHART_COLORS.magenta, CHART_COLORS.green];

export function DotcomOverlay({ bundle }: { bundle: DataBundle }) {
  const series = bundle.history?.overlay ?? [];
  const option = useMemo(
    () => ({
      grid: { left: 56, right: 24, top: 58, bottom: 46 },
      legend: { top: 0, type: 'scroll' },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any[]) =>
          [`<b>day ${ps?.[0]?.value?.[0]} vs peak</b>`, ...(ps ?? []).filter((p) => isNum(p.value?.[1])).map((p) => `${p.marker} ${p.seriesName}: ${num(p.value[1], 1)}`)].join('<br/>'),
      },
      xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', name: 'trading days relative to each series’ peak', nameLocation: 'middle', nameGap: 28, ...axisStyle() },
      yAxis: { type: 'value', name: 'index (peak = 100)', nameLocation: 'middle', nameGap: 36, ...axisStyle() },
      series: series.map((s, i) => ({
        type: 'line',
        name: s.label.includes(s.peak_date) ? s.label : `${s.label} (peak ${s.peak_date})`,
        data: s.t.map((t, k) => [t, isNum(s.v[k]) ? s.v[k] : null]),
        showSymbol: false,
        lineStyle: { width: /dot|2000|IXIC/i.test(s.label) ? 1.5 : 2.5, color: OVERLAY_COLORS[i % OVERLAY_COLORS.length] },
        itemStyle: { color: OVERLAY_COLORS[i % OVERLAY_COLORS.length] },
        markLine:
          i === 0
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: CHART_COLORS.red, type: 'dashed' },
                label: { color: CHART_COLORS.red, formatter: 'peak', position: 'end' },
                data: [{ xAxis: 0 }, { yAxis: 100, label: { show: false } }],
              }
            : undefined,
      })),
    }),
    [series],
  );
  if (!series.length) return <Empty note="history.overlay is empty in data.json" />;
  return (
    <Section title="Overlay — dot-com Nasdaq vs today's SOX / NDX, indexed to peak">
      <Chart option={option} height={380} />
      <Note>
        Each series is rebased to 100 at its own peak close (dot-com: March-2000 peaks; today: latest all-time high in the data). COMPUTED from
        Yahoo Finance daily closes. An overlay is a visual analogy, not a forecast — the 2000-02 path included an earnings collapse and a
        recession.
      </Note>
    </Section>
  );
}

export function DeepSeekTable({ bundle }: { bundle: DataBundle }) {
  const rows = bundle.history?.deepseek_next_day ?? [];
  const names = new Map((bundle.india ?? []).map((t) => [t.ticker, t.display || t.ticker]));
  const sorted = [...rows].sort((a, b) => (a.r_jan28 ?? Infinity) - (b.r_jan28 ?? Infinity));
  const option = useMemo(
    () => ({
      grid: { left: 110, right: 24, top: 10, bottom: 30 },
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${spct(p.value, 2)}` },
      xAxis: { type: 'value', ...axisStyle({ axisLabel: { color: CHART_COLORS.amber, fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(0)}%` } }) },
      yAxis: { type: 'category', inverse: true, data: sorted.map((r) => names.get(r.ticker) ?? r.ticker), ...axisStyle() },
      series: [
        {
          type: 'bar',
          data: sorted.map((r) => ({
            value: isNum(r.r_jan28) ? r.r_jan28 : null,
            itemStyle: { color: r.tier ? CHART_COLORS.tiers[r.tier] : CHART_COLORS.amber },
          })),
        },
      ],
    }),
    [sorted, names],
  );
  if (!rows.length) return <Empty note="history.deepseek_next_day is empty in data.json" />;
  return (
    <div className="b-grid-2">
      <Section title="DeepSeek shock — Indian names on 27-Jan-2025 and the next session (28-Jan-2025)">
        <div className="b-scroll-lg">
          <table className="tbl b-tbl">
            <thead>
              <tr>
                <th>NAME</th>
                <th>TIER</th>
                <th className="num">27-JAN (log)</th>
                <th className="num">28-JAN (log)</th>
                <th className="num">AR 28-JAN vs NIFTY</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.ticker}>
                  <td className="lbl" title={r.ticker}>
                    {names.get(r.ticker) ?? r.ticker}
                  </td>
                  <td>{r.tier ?? '—'}</td>
                  <MoveCell v={r.r_jan27} digits={2} />
                  <MoveCell v={r.r_jan28} digits={2} />
                  <MoveCell v={r.ar_jan28} digits={2} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note>
          The DeepSeek news broke over the weekend; the US sell-off happened in the US session of Monday 27-Jan-2025, i.e. after the NSE close,
          so the information-set rule puts the US move into India's 28-Jan session. COMPUTED from daily closes.
        </Note>
      </Section>
      <Section title="28-Jan-2025 return by name (tier colour)">
        <Chart option={option} height={Math.max(260, sorted.length * 16 + 50)} />
      </Section>
    </div>
  );
}

const HORIZON_KEY = { '1D': 'd1', '1M': 'd21', '12M': 'd252' } as const;

export function CalibrationCheck({ bundle, result }: { bundle: DataBundle; result: ScenarioResult | null | undefined }) {
  const ww = bundle.history?.worst_windows;
  const replays = bundle.history?.replay_windows ?? [];
  const horizon = result?.params?.horizon ?? '1D';
  const moveCols = ['SOX', 'NDX', 'SPX', 'IXIC', 'NIFTY', 'SENSEX', 'NIFTYIT'];
  const distinctNotes = new Set(replays.map((w) => w.note ?? ''));
  const perRowNotes = distinctNotes.size > 1;
  const commonNote = replays[0]?.note ?? null;
  return (
    <div>
      <Section title={`Scenario factor moves vs historical worst windows (current preset: ${result?.preset?.label ?? '—'}, horizon ${horizon})`}>
        {ww ? (
          <table className="tbl b-tbl">
            <thead>
              <tr>
                <th>FACTOR</th>
                <th className="num">SCENARIO MOVE</th>
                <th className="num">WORST 1 DAY</th>
                <th>DATE</th>
                <th className="num">WORST 21 DAYS</th>
                <th>ENDING</th>
                <th className="num">WORST 252 DAYS</th>
                <th>ENDING</th>
                <th className="num">SCENARIO ÷ WORST ({horizon})</th>
              </tr>
            </thead>
            <tbody>
              {(['SOX', 'NDX'] as const).map((f) => {
                const w = ww[f];
                const scen = result?.factors?.[f];
                const ref = w ? logToSimple(w[HORIZON_KEY[horizon]]) : null;
                const ratio = moveRatio(scen, ref);
                return (
                  <tr key={f}>
                    <td className="lbl">{f}</td>
                    <MoveCell v={scen} />
                    <MoveCell v={logToSimple(w?.d1)} />
                    <td className="nowrap">{w?.d1_date ?? '—'}</td>
                    <MoveCell v={logToSimple(w?.d21)} />
                    <td className="nowrap">{w?.d21_end ?? '—'}</td>
                    <MoveCell v={logToSimple(w?.d252)} />
                    <td className="nowrap">{w?.d252_end ?? '—'}</td>
                    <td className={`num ${isNum(ratio) && ratio > 1 ? 'b-warn' : 'white'}`}>{isNum(ratio) ? `${num(ratio, 2)}×` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty note="history.worst_windows missing in data.json" />
        )}
        <Note>
          Worst windows are COMPUTED from daily closes since the index's first available date (SOX from 1994) and converted from log to simple
          returns. A ratio above 1× means the scenario is more severe than anything in the data for that horizon — not impossible, but
          outside the historical record.
        </Note>
      </Section>
      <Section title="Historical replay windows (shock 6) — actual factor moves">
        {replays.length ? (
          <div className="b-scroll">
            <table className="tbl b-tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>WINDOW</th>
                  <th>FROM</th>
                  <th>TO</th>
                  {moveCols.map((c) => (
                    <th key={c} className="num">
                      {c}
                    </th>
                  ))}
                  <th>STATUS</th>
                  {perRowNotes ? <th className="wrap">NOTE</th> : null}
                </tr>
              </thead>
              <tbody>
                {replays.map((w) => (
                  <tr key={w.id}>
                    <td className="lbl">{w.id}</td>
                    <td className="txt">{w.label}</td>
                    <td className="nowrap">{w.start}</td>
                    <td className="nowrap">{w.end}</td>
                    {moveCols.map((c) => (
                      <MoveCell key={c} v={logToSimple(w.moves?.[c])} />
                    ))}
                    <td>
                      <StatusBadge status={w.status} />
                      <SourceLinks ids={w.src ?? []} bundle={bundle} />
                    </td>
                    {perRowNotes ? <td className="txt muted">{w.note ?? ''}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty note="history.replay_windows is empty in data.json" />
        )}
        {!perRowNotes && commonNote ? <Note>{commonNote}</Note> : null}
        <Note>Close-to-close moves over each window, COMPUTED and shown as simple returns. "—" = the series did not exist yet (e.g. Nifty before Sep-2007 on Yahoo).</Note>
      </Section>
    </div>
  );
}
