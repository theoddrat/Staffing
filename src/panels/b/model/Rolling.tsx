// F5 / ROLLING — 1-year rolling betas for one India target, with the 30-Nov-2022 (ChatGPT) marker.
import { useMemo } from 'react';
import type { DataBundle } from '../../../types/data';
import Chart, { axisStyle, CHART_COLORS } from '../../../components/Chart';
import { isNum, num } from '../../../lib/format';
import { Empty, Note, Section } from '../common';
import { prePostAverages } from '../util';

const SERIES: { key: 'SOX' | 'NDX' | 'PARENT' | 'NIFTY'; label: string; color: string }[] = [
  { key: 'SOX', label: 'b_SOX (lagged)', color: CHART_COLORS.amber },
  { key: 'NDX', label: 'b_NDX (lagged)', color: CHART_COLORS.cyan },
  { key: 'PARENT', label: 'b_P (parent)', color: CHART_COLORS.magenta },
  { key: 'NIFTY', label: 'b_N (Nifty)', color: CHART_COLORS.green },
];

export default function Rolling({
  bundle,
  ticker,
  onSelect,
}: {
  bundle: DataBundle;
  ticker: string | null;
  onSelect: (t: string) => void;
}) {
  const targets = bundle.india ?? [];
  const target = targets.find((t) => t.ticker === ticker) ?? targets[0];
  const pivot = bundle.meta?.pre_chatgpt?.date ?? '2022-11-30';
  const rolling = target?.rolling ?? null;

  const option = useMemo(() => {
    if (!rolling?.dates?.length) return {};
    const series: any[] = SERIES.filter((s) => s.key !== 'PARENT' || rolling.PARENT).map((s, i) => ({
      type: 'line',
      name: s.label,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.6, color: s.color },
      itemStyle: { color: s.color },
      data: rolling.dates.map((d, k) => [d, isNum((s.key === 'PARENT' ? rolling.PARENT : rolling[s.key])?.[k]) ? (s.key === 'PARENT' ? rolling.PARENT : rolling[s.key])![k] : null]),
      markLine:
        i === 0
          ? {
              symbol: 'none',
              silent: true,
              lineStyle: { color: CHART_COLORS.red, type: 'dashed' },
              label: { color: CHART_COLORS.red, formatter: `ChatGPT ${pivot}` },
              data: [{ xAxis: pivot }],
            }
          : undefined,
    }));
    series.push({
      type: 'line',
      name: 'R²',
      yAxisIndex: 1,
      showSymbol: false,
      lineStyle: { width: 1, type: 'dotted', color: CHART_COLORS.grey },
      itemStyle: { color: CHART_COLORS.grey },
      data: rolling.dates.map((d, k) => [d, isNum(rolling.r2?.[k]) ? rolling.r2[k] : null]),
    });
    return {
      grid: { left: 52, right: 52, top: 50, bottom: 36 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any[]) =>
          [`<b>${String(ps?.[0]?.value?.[0] ?? '')}</b> (window ending)`, ...(ps ?? []).filter((p) => isNum(p.value?.[1])).map((p) => `${p.marker} ${p.seriesName}: ${num(p.value[1], 3)}`)].join('<br/>'),
      },
      xAxis: { type: 'time', ...axisStyle() },
      yAxis: [
        { type: 'value', name: 'beta', ...axisStyle() },
        { type: 'value', name: 'R²', min: 0, max: 1, ...axisStyle({ splitLine: { show: false } }) },
      ],
      series,
    };
  }, [rolling, pivot]);

  const pp = prePostAverages(rolling, pivot);
  if (!targets.length) return <Empty note="no India targets in data.json" />;

  return (
    <Section
      title={`Rolling 1-year betas — ${target?.display || target?.ticker || '—'} (${target?.name ?? ''})`}
      right={
        <select value={target?.ticker ?? ''} onChange={(e) => onSelect(e.target.value)}>
          {targets.map((t) => (
            <option key={t.ticker} value={t.ticker}>
              {t.tier} · {t.display || t.ticker}
            </option>
          ))}
        </select>
      }
    >
      {rolling?.dates?.length ? <Chart option={option} height={340} /> : <Empty note="no rolling series for this stock (history shorter than one window)" />}
      {pp.length ? (
        <table className="tbl b-tbl" style={{ marginTop: 4, maxWidth: 640 }}>
          <thead>
            <tr>
              <th>COEFFICIENT</th>
              <th className="num">AVG, WINDOWS ENDING BEFORE {pivot}</th>
              <th className="num">AVG, WINDOWS ENDING ON/AFTER</th>
              <th className="num">CHANGE</th>
            </tr>
          </thead>
          <tbody>
            {pp.map((r) => (
              <tr key={r.key}>
                <td className="lbl">{r.key === 'r2' ? 'R²' : r.key === 'PARENT' ? 'b_P' : r.key === 'NIFTY' ? 'b_N' : `b_${r.key}`}</td>
                <td className="num">{num(r.pre, 3)}</td>
                <td className="num">{num(r.post, 3)}</td>
                <td className={`num ${isNum(r.pre) && isNum(r.post) ? (r.post - r.pre > 0 ? 'up' : 'down') : 'muted'}`}>
                  {isNum(r.pre) && isNum(r.post) ? `${r.post - r.pre > 0 ? '+' : ''}${num(r.post - r.pre, 3)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Note>
        252-session windows stepped every 5 sessions, same specification as the main model (COMPUTED). Windows that straddle {pivot} mix both
        regimes, so the before/after averages understate a break. A rising b_SOX / b_NDX after the ChatGPT launch indicates a stronger US-AI linkage.
      </Note>
    </Section>
  );
}
