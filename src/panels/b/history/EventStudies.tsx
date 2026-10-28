// F4 / EVENT STUDIES — cumulative abnormal returns from day -5 to +60 vs the local index.
import { useEffect, useMemo, useState } from 'react';
import type { DataBundle, EventStudy } from '../../../types/data';
import Chart, { axisStyle, CHART_COLORS } from '../../../components/Chart';
import { SourceLinks } from '../../../components/StatusBadge';
import { isNum, spct } from '../../../lib/format';
import { CrashTags, Empty, MoveCell, Note } from '../common';
import { windowDays } from '../util';

function tierColor(tier: string | null | undefined, i: number): string {
  if (tier && CHART_COLORS.tiers[tier]) return CHART_COLORS.tiers[tier];
  const cycle = [CHART_COLORS.amber, CHART_COLORS.cyan, CHART_COLORS.magenta, CHART_COLORS.green, '#c9a0ff', '#ff8c1a'];
  return cycle[i % cycle.length];
}

function EventChart({ ev, groupIdx }: { ev: EventStudy; groupIdx: number }) {
  const g = ev.groups[groupIdx];
  const option = useMemo(() => {
    if (!g) return {};
    const len = Math.max(g.mean_car?.length ?? 0, ...g.members.map((m) => m.car?.length ?? 0));
    const days = windowDays(ev.window, len);
    const memberSeries = g.members.map((m, i) => ({
      type: 'line',
      name: m.label || m.ticker,
      data: days.map((d, k) => [d, isNum(m.car?.[k]) ? m.car[k] : null]),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1, opacity: 0.55, color: tierColor(m.tier, i) },
      itemStyle: { color: tierColor(m.tier, i) },
      emphasis: { focus: 'series', lineStyle: { width: 2, opacity: 1 } },
      z: 2,
    }));
    const meanSeries = {
      type: 'line',
      name: `${g.name} — MEAN`,
      data: days.map((d, k) => [d, isNum(g.mean_car?.[k]) ? g.mean_car[k] : null]),
      showSymbol: false,
      lineStyle: { width: 3, color: CHART_COLORS.white },
      itemStyle: { color: CHART_COLORS.white },
      z: 5,
      markLine: {
        symbol: 'none',
        silent: true,
        lineStyle: { color: CHART_COLORS.red, type: 'dashed' },
        label: { color: CHART_COLORS.red, formatter: 'day 0', position: 'end' },
        data: [{ xAxis: 0 }],
      },
    };
    return {
      grid: { left: 56, right: 18, top: 24, bottom: 40 },
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const day = ps[0].value?.[0];
          const rows = ps
            .filter((p) => isNum(p.value?.[1]))
            .sort((a, b) => a.value[1] - b.value[1]);
          const mean = rows.find((p) => String(p.seriesName).endsWith('MEAN'));
          const others = rows.filter((p) => p !== mean);
          const show = others.length > 12 ? [...others.slice(0, 6), null, ...others.slice(-6)] : others;
          const line = (p: any) => `${p.marker} ${p.seriesName}: ${spct(p.value[1], 1)}`;
          return [
            `<b>day ${day}</b>`,
            mean ? line(mean) : '',
            ...show.map((p) => (p ? line(p) : '…')),
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      xAxis: { type: 'value', min: days[0], max: days[days.length - 1], name: 'trading days from event', nameLocation: 'middle', nameGap: 24, ...axisStyle() },
      yAxis: {
        type: 'value',
        name: 'CAR',
        nameLocation: 'middle',
        nameGap: 44,
        ...axisStyle({ axisLabel: { color: CHART_COLORS.amber, fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(0)}%` } }),
      },
      series: [...memberSeries, meanSeries],
    };
  }, [ev, g]);
  if (!g) return <Empty note="no groups in this event study" />;
  return <Chart option={option} height={330} />;
}

export default function EventStudies({ bundle, focusEventId }: { bundle: DataBundle; focusEventId: string | null }) {
  const events = bundle.history?.event_studies ?? [];
  const [sel, setSel] = useState<string | null>(focusEventId ?? events[0]?.id ?? null);
  const [groupIdx, setGroupIdx] = useState(0);
  useEffect(() => {
    if (focusEventId) setSel(focusEventId);
  }, [focusEventId]);
  useEffect(() => setGroupIdx(0), [sel]);

  const ev = events.find((e) => e.id === sel) ?? events[0];
  if (!events.length || !ev) return <Empty note="history.event_studies is empty in data.json" />;
  const g = ev.groups[groupIdx] ?? ev.groups[0];
  const members = [...(g?.members ?? [])].sort((a, b) => (a.car_end ?? Infinity) - (b.car_end ?? Infinity));

  return (
    <div className="b-grid-3" style={{ gridTemplateColumns: 'minmax(220px, 0.55fr) minmax(0, 1.6fr) minmax(0, 1fr)' }}>
      <div className="panel">
        <div className="panel-header">EVENTS ({events.length})</div>
        <div className="b-scroll-lg">
          <table className="tbl b-tbl">
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={`clickable${e.id === ev.id ? ' sel' : ''}`} onClick={() => setSel(e.id)}>
                  <td>
                    <div className="lbl amber">{e.label}</div>
                    <div className="muted">
                      {e.date} <CrashTags types={e.crash_types} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <span>
            {ev.label} — {ev.date}
          </span>
          <span className="spacer" />
          <SourceLinks ids={ev.src ?? []} bundle={bundle} />
        </div>
        <div className="panel-body">
          <div className="b-toolbar">
            {ev.groups.map((gr, i) => (
              <button key={gr.name} className={`b-chip${i === groupIdx ? ' active' : ''}`} onClick={() => setGroupIdx(i)}>
                {gr.name} <span className="muted">vs {gr.index}</span> ({gr.members.length})
              </button>
            ))}
          </div>
          <EventChart ev={ev} groupIdx={Math.min(groupIdx, ev.groups.length - 1)} />
          <div className="b-chart-caption">
            CAR = cumulative abnormal return (sum of daily abnormal log returns) vs the local index; market model with α, β estimated on days
            [−250, −11], market-adjusted where history is too short. Thin = members (tier colour), thick white = group mean.
            {ev.note ? ` ${ev.note}` : ''}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">MEMBERS — {g?.name ?? '—'}</div>
        <div className="b-scroll-lg">
          {members.length ? (
            <table className="tbl b-tbl">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>TIER</th>
                  <th className="num">AR d0</th>
                  <th className="num">AR d+1</th>
                  <th className="num">CAR END</th>
                  <th>METHOD</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.ticker}>
                    <td className="lbl" title={m.ticker}>
                      {m.label || m.ticker}
                    </td>
                    <td>{m.tier ?? '—'}</td>
                    <MoveCell v={m.ar0} />
                    <MoveCell v={m.ar1} />
                    <MoveCell v={m.car_end} />
                    <td className="muted">{m.method === 'market_model' ? 'mkt model' : 'mkt adj'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty note="no members" />
          )}
          <Note>All values COMPUTED from daily closes (Yahoo Finance via yfinance).</Note>
        </div>
      </div>
    </div>
  );
}
