// F5 / HEATMAP — every India target vs every shock origin: lagged beta, correlation or HAC t.
import { useMemo, useState } from 'react';
import type { DataBundle } from '../../../types/data';
import Chart, { CHART_COLORS } from '../../../components/Chart';
import { isNum, num } from '../../../lib/format';
import { Empty, Note, Section } from '../common';
import { symmetricBound } from '../util';

type Metric = 'beta' | 'corr' | 't';

export default function Heatmap({ bundle, onSelect }: { bundle: DataBundle; onSelect: (t: string) => void }) {
  const hm = bundle.heatmap;
  const [metric, setMetric] = useState<Metric>('beta');
  const display = useMemo(() => new Map((bundle.india ?? []).map((t) => [t.ticker, t.display || t.ticker])), [bundle.india]);
  const tierOf = useMemo(() => new Map((bundle.india ?? []).map((t) => [t.ticker, t.tier])), [bundle.india]);

  const option = useMemo(() => {
    if (!hm?.targets?.length || !hm?.origins?.length) return {};
    const data: [number, number, number | null][] = [];
    const vals: (number | null)[] = [];
    hm.targets.forEach((_, ti) => {
      hm.origins.forEach((__, oi) => {
        const c = hm.cells?.[ti]?.[oi];
        const v = c ? c[metric] : null;
        const fv = isNum(v) ? v : null;
        vals.push(fv);
        data.push([oi, ti, fv]);
      });
    });
    const bound = metric === 'corr' ? Math.min(1, symmetricBound(vals, 0.98)) : symmetricBound(vals, 0.98);
    return {
      grid: { left: 110, right: 70, top: 10, bottom: 70 },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const [oi, ti] = p.value;
          const c = hm.cells?.[ti]?.[oi];
          const t = hm.targets[ti];
          return [
            `<b>${display.get(t) ?? t}</b> (Tier ${tierOf.get(t) ?? '—'}) on <b>${hm.origins[oi]}</b> (t−1 aligned)`,
            `beta: ${num(c?.beta, 3)} · corr: ${num(c?.corr, 3)} · HAC t: ${num(c?.t, 2)}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: hm.origins,
        axisLabel: { color: CHART_COLORS.amber, fontSize: 9, rotate: 60, interval: 0 },
        axisLine: { lineStyle: { color: CHART_COLORS.grey } },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: hm.targets.map((t) => `${tierOf.get(t) ?? ''} ${display.get(t) ?? t}`),
        axisLabel: { color: CHART_COLORS.amber, fontSize: 9, interval: 0 },
        axisLine: { lineStyle: { color: CHART_COLORS.grey } },
        inverse: true,
      },
      visualMap: {
        min: -bound,
        max: bound,
        calculable: true,
        orient: 'vertical',
        right: 4,
        top: 'middle',
        itemHeight: 220,
        text: ['+', '−'],
        textStyle: { color: CHART_COLORS.amber, fontSize: 10 },
        inRange: { color: ['#33c7ff', '#0f3a4d', '#0b0b0b', '#5a3c00', '#ffb000', '#ff3b3b'] },
        outOfRange: { color: ['#555'] },
        formatter: (v: number) => num(v, metric === 't' ? 1 : 2),
      },
      series: [
        {
          type: 'heatmap',
          data: data.map(([x, y, v]) => [x, y, v ?? '-']),
          itemStyle: { borderColor: '#000', borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: CHART_COLORS.white, borderWidth: 1 } },
          progressive: 0,
        },
      ],
    };
  }, [hm, metric, display, tierOf]);

  if (!hm?.targets?.length || !hm?.origins?.length) return <Empty note="heatmap missing in data.json" />;
  const height = Math.max(320, hm.targets.length * 15 + 90);
  return (
    <Section
      title={`Heatmap — India targets × shock origins (${metric === 'beta' ? 'univariate lagged beta' : metric === 'corr' ? 'correlation' : 'HAC t-stat'})`}
      right={
        <span className="b-toolbar" style={{ margin: 0 }}>
          {(['beta', 'corr', 't'] as Metric[]).map((m) => (
            <button key={m} className={`b-chip${metric === m ? ' active' : ''}`} onClick={() => setMetric(m)}>
              {m === 't' ? 'T-STAT' : m.toUpperCase()}
            </button>
          ))}
        </span>
      }
    >
      <Chart
        option={option}
        height={height}
        onClick={(p: any) => {
          const ti = p?.value?.[1];
          if (typeof ti === 'number' && hm.targets[ti]) onSelect(hm.targets[ti]);
        }}
      />
      <Note>
        Each cell: OLS of the Indian stock's daily log return on the origin's information-set-aligned return (US close before the NSE session) over
        the regression window — COMPUTED. Colour scale is symmetric around 0 and clipped at the 98th percentile of |value|; blank cell = no overlapping history.
        Click a row to select that stock.
      </Note>
    </Section>
  );
}
