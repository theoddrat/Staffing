// F2 INDIA IMPACT — ranked table (all Layer 2/3/4 outputs), treemap of ₹ mcap change, MC fan chart.
import { useMemo, useState } from 'react';
import type { PanelProps } from './types';
import type { IndiaResult, MCResult } from '../types/engine';
import type { Tier } from '../types/data';
import Chart, { axisStyle, CHART_COLORS } from '../components/Chart';
import { StatusBadge } from '../components/StatusBadge';
import { crore, isNum, num, pct, signClass, spct } from '../lib/format';
import type { ExtState } from '../state/store';
import { HelpChip } from '../learn/Term';
import type { GlossaryId } from '../learn/ids';

const TIERS: (Tier | 'ALL')[] = ['ALL', 'A', 'B', 'C', 'D'];
const TIER_LABEL: Record<Tier, string> = {
  A: 'A · PARENT LINK',
  B: 'B · US TECH REVENUE',
  C: 'C · AI / DC CAPEX CHAIN',
  D: 'D · SEMI / ELECTRONICS THEME',
};
const CHANNEL_LABEL: Record<string, string> = {
  parent: 'PARENT',
  revenue: 'REVENUE',
  capex: 'CAPEX ORDERS',
  credit: 'CREDIT',
  sentiment: 'SENTIMENT',
  fx_fpi: 'FX/FPI',
  fx: 'FX',
  own: 'OWN SHOCK',
};

type Col =
  | 'rank'
  | 'display'
  | 'tier'
  | 'channel'
  | 'beta'
  | 'beta_dn'
  | 'market'
  | 'fund_g'
  | 'fund_n'
  | 'gap'
  | 'prem'
  | 'p5'
  | 'p50'
  | 'p95'
  | 'mcap'
  | 'conf';

/** Red (loss) ↔ green (gain) colour for a simple move; `scale` = |move| that maps to full colour. */
export function moveColor(m: number | null | undefined, scale = 0.4): string {
  if (!isNum(m)) return '#333';
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  if (m < 0) {
    const t = clamp(-m / scale, 0, 1);
    const r = Math.round(60 + 195 * t);
    const g = Math.round(20 + 40 * (1 - t));
    return `rgb(${r},${g},${Math.round(20 + 20 * (1 - t))})`;
  }
  const t = clamp(m / scale, 0, 1);
  return `rgb(${Math.round(20 + 20 * (1 - t))},${Math.round(70 + 140 * t)},${Math.round(40 + 66 * t)})`;
}

function rangeFor(r: IndiaResult, stale: MCResult | null): { p5: number; p50: number; p95: number; stale: boolean } | null {
  if (r.range) return { ...r.range, stale: false };
  const s = stale?.perStock[r.ticker]?.market;
  return s ? { ...s, stale: true } : null;
}

function sortValue(r: IndiaResult, col: Col, idx: number, stale: MCResult | null): number | string {
  const rg = rangeFor(r, stale);
  switch (col) {
    case 'rank':
      return idx;
    case 'display':
      return r.display;
    case 'tier':
      return r.tier;
    case 'channel':
      return r.dominant_channel;
    case 'beta':
      return r.beta_total ?? -Infinity;
    case 'beta_dn':
      return r.beta_total_down ?? -Infinity;
    case 'market':
      return r.market_move;
    case 'fund_g':
      return r.fundamental_gross ?? Infinity;
    case 'fund_n':
      return r.fundamental_net ?? Infinity;
    case 'gap':
      return r.gap ?? Infinity;
    case 'prem':
      return r.ai_premium ?? -Infinity;
    case 'p5':
      return rg?.p5 ?? Infinity;
    case 'p50':
      return rg?.p50 ?? Infinity;
    case 'p95':
      return rg?.p95 ?? Infinity;
    case 'mcap':
      return r.mcap_change_inr_cr ?? 0;
    case 'conf':
      return r.confidence.score;
  }
}

function Treemap({ rows, onPick }: { rows: IndiaResult[]; onPick: (t: string) => void }) {
  const option = useMemo(() => {
    // Colour scale adapts to the scenario: the largest |move| on screen gets full red / green.
    const scale = Math.max(0.02, ...rows.map((r) => (isNum(r.market_move) ? Math.abs(r.market_move) : 0)));
    const byTier = new Map<Tier, IndiaResult[]>();
    for (const r of rows) {
      if (!isNum(r.mcap_change_inr_cr) || Math.abs(r.mcap_change_inr_cr) < 1e-6) continue;
      if (!byTier.has(r.tier)) byTier.set(r.tier, []);
      byTier.get(r.tier)!.push(r);
    }
    const data = Array.from(byTier.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, list]) => ({
        name: `TIER ${t}`,
        itemStyle: { borderColor: CHART_COLORS.tiers[t], borderWidth: 1 },
        children: list.map((r) => ({
          name: r.display,
          value: Math.abs(r.mcap_change_inr_cr as number),
          ticker: r.ticker,
          move: r.market_move,
          signed: r.mcap_change_inr_cr,
          itemStyle: { color: moveColor(r.market_move, scale) },
        })),
      }));
    return {
      tooltip: {
        formatter: (p: any) => {
          const d = p.data ?? {};
          if (!d.ticker) return `${p.name}<br/>|Δmcap| ${crore(p.value)}`;
          return `${p.name} (${d.ticker})<br/>market-implied ${spct(d.move)}<br/>Δmcap ${crore(d.signed)}`;
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          top: 4,
          left: 2,
          right: 2,
          bottom: 2,
          label: {
            show: true,
            color: '#fff',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            formatter: (p: any) => (p.data?.ticker ? `${p.name}\n${spct(p.data.move)}` : p.name),
          },
          upperLabel: { show: true, height: 14, color: CHART_COLORS.amber, fontSize: 10, backgroundColor: '#140e00' },
          levels: [
            { itemStyle: { borderColor: '#000', borderWidth: 2, gapWidth: 2 } },
            { itemStyle: { borderColor: '#000', borderWidth: 1, gapWidth: 1 } },
          ],
          data,
        },
      ],
    };
  }, [rows]);
  const hasData = rows.some((r) => isNum(r.mcap_change_inr_cr) && Math.abs(r.mcap_change_inr_cr) > 1e-6);
  if (!hasData) return <div className="panel-body muted">NO MARKET-CAP CHANGE UNDER THIS SCENARIO.</div>;
  return (
    <Chart
      option={option}
      height={330}
      onClick={(p: any) => {
        if (p?.data?.ticker) onPick(p.data.ticker);
      }}
    />
  );
}

function FanChart({ mc, ticker, display }: { mc: MCResult | null; ticker: string | null; display: string }) {
  const fan = mc?.fan && mc.fan.ticker === ticker ? mc.fan : null;
  const option = useMemo(() => {
    if (!fan) return null;
    const x = fan.days;
    const p = (a: number[]) => a.map((v) => (isNum(v) ? +(v * 100).toFixed(3) : null));
    const p5 = p(fan.p5);
    const p25 = p(fan.p25);
    const p50 = p(fan.p50);
    const p75 = p(fan.p75);
    const p95 = p(fan.p95);
    const diff = (hi: (number | null)[], lo: (number | null)[]) => hi.map((h, i) => (h != null && lo[i] != null ? h - (lo[i] as number) : null));
    return {
      grid: { left: 48, right: 12, top: 24, bottom: 30 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (isNum(v) ? `${v.toFixed(1)}%` : '—') },
      xAxis: { type: 'category', data: x, name: 'trading days', nameLocation: 'middle', nameGap: 20, ...axisStyle() },
      yAxis: { type: 'value', name: '%', ...axisStyle(), axisLabel: { color: CHART_COLORS.amber, formatter: '{value}%' } },
      series: [
        // Bands: invisible base + stacked width. stackStrategy 'all' stacks across signs (p5 is usually < 0).
        { name: 'band5', type: 'line', data: p5, stack: 'outer', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
        {
          name: 'P5–P95',
          type: 'line',
          data: diff(p95, p5),
          stack: 'outer',
          stackStrategy: 'all',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          itemStyle: { color: 'rgba(255,176,0,0.35)' },
          areaStyle: { color: 'rgba(255,176,0,0.12)' },
          tooltip: { show: false },
          silent: true,
        },
        { name: 'band25', type: 'line', data: p25, stack: 'inner', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
        {
          name: 'P25–P75',
          type: 'line',
          data: diff(p75, p25),
          stack: 'inner',
          stackStrategy: 'all',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          itemStyle: { color: 'rgba(255,176,0,0.6)' },
          areaStyle: { color: 'rgba(255,176,0,0.28)' },
          tooltip: { show: false },
          silent: true,
        },
        { name: 'P5', type: 'line', data: p5, symbol: 'none', itemStyle: { color: CHART_COLORS.red }, lineStyle: { color: CHART_COLORS.red, width: 1, type: 'dashed' } },
        { name: 'P50', type: 'line', data: p50, symbol: 'none', itemStyle: { color: CHART_COLORS.amber }, lineStyle: { color: CHART_COLORS.amber, width: 2 } },
        { name: 'P95', type: 'line', data: p95, symbol: 'none', itemStyle: { color: CHART_COLORS.green }, lineStyle: { color: CHART_COLORS.green, width: 1, type: 'dashed' } },
      ],
      legend: { top: 0, data: ['P5', 'P50', 'P95', 'P25–P75', 'P5–P95'], textStyle: { color: CHART_COLORS.amber, fontSize: 10 } },
    };
  }, [fan]);
  if (!option) {
    return (
      <div className="panel-body muted">
        {mc ? `NO FAN FOR ${display} IN THE LAST MONTE CARLO RUN.` : 'MONTE CARLO NOT RUN YET — TYPE MC <GO> OR WAIT A MOMENT.'}
      </div>
    );
  }
  return <Chart option={option} height={230} />;
}

export default function ImpactPanel(props: PanelProps) {
  const { state, actions } = props;
  const ext = state as ExtState;
  const staleMc = state.mc ? null : ext.lastMc;
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'market', dir: 1 });

  const ranked = state.result.india; // engine order: market move ascending
  const filtered = useMemo(
    () => (state.tierFilter === 'ALL' ? ranked : ranked.filter((r) => r.tier === state.tierFilter)),
    [ranked, state.tierFilter],
  );
  const rankOf = useMemo(() => new Map(ranked.map((r, i) => [r.ticker, i + 1])), [ranked]);
  const rows = useMemo(() => {
    const r = [...filtered];
    r.sort((a, b) => {
      const ka = sortValue(a, sort.col, rankOf.get(a.ticker) ?? 0, staleMc);
      const kb = sortValue(b, sort.col, rankOf.get(b.ticker) ?? 0, staleMc);
      const c = typeof ka === 'string' ? ka.localeCompare(kb as string) : (ka as number) - (kb as number);
      return c * sort.dir;
    });
    return r;
  }, [filtered, sort, rankOf, staleMc]);

  const mcForFan = state.mc ?? ext.lastMc;
  const fanTicker = mcForFan?.fan?.ticker ?? null;
  const sel = rows.find((r) => r.ticker === state.selected) ?? rows.find((r) => r.ticker === fanTicker) ?? rows[0] ?? null;
  const selMc = sel ? (state.mc ?? ext.lastMc)?.perStock[sel.ticker] : undefined;

  const totals = useMemo(() => {
    let sum = 0;
    let n = 0;
    let avg = 0;
    for (const r of filtered) {
      if (isNum(r.mcap_change_inr_cr)) sum += r.mcap_change_inr_cr;
      avg += r.market_move;
      n += 1;
    }
    return { sum, n, avg: n ? avg / n : 0 };
  }, [filtered]);

  const th = (col: Col, label: string, title?: string, cls = '', term?: GlossaryId) => (
    <th
      className={`sortable ${cls} ${sort.col === col ? 'sorted' : ''}`}
      title={title}
      onClick={() =>
        setSort((s) => ({
          col,
          // first click: losses / exposure first (ascending moves, descending betas, premia, confidence)
          dir: s.col === col ? ((-s.dir) as 1 | -1) : col === 'beta' || col === 'beta_dn' || col === 'prem' || col === 'conf' ? -1 : 1,
        }))
      }
    >
      {label}
      {sort.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      {term && <HelpChip id={term} />}
    </th>
  );

  return (
    <div className="impact-panel">
      <div className="panel">
        <div className="panel-header">
          F2 INDIA IMPACT — {state.result.preset.num}. {state.result.preset.label.toUpperCase()} · {state.params.horizon}
          <span className="spacer" />
          {TIERS.map((t) => (
            <button key={t} className={`btn btn-xs ${state.tierFilter === t ? 'active' : ''}`} onClick={() => actions.setTierFilter(t)}>
              {t === 'ALL' ? 'ALL' : `TIER ${t}`}
            </button>
          ))}
        </div>
        <div className="totals-line">
          <span>
            {totals.n} NAMES{state.tierFilter !== 'ALL' ? ` · ${TIER_LABEL[state.tierFilter]}` : ''}
          </span>
          <span>
            Σ ΔMCAP <b className={signClass(totals.sum)}>{crore(totals.sum)}</b>
          </span>
          <span>
            AVG MARKET-IMPLIED <b className={signClass(totals.avg)}>{spct(totals.avg)}</b>
          </span>
          <span>
            ALL-INDIA Σ <b className={signClass(state.result.totals.india_mcap_change_inr_cr)}>{crore(state.result.totals.india_mcap_change_inr_cr)}</b>
          </span>
          <span className="muted">
            {state.mcRunning ? 'MC RUNNING…' : state.mc ? `MC ${state.mc.runs.toLocaleString()} RUNS · ${state.mc.days}D` : staleMc ? 'MC STALE' : 'MC PENDING'}
          </span>
        </div>
        <div className="scroll impact-scroll">
          <table className="tbl impact-tbl">
            <thead>
              <tr>
                {th('rank', '#', 'Rank by market-implied move (most negative first)', 'num')}
                {th('display', 'SYM')}
                <th>NAME</th>
                {th('tier', 'T', undefined, '', 'tier')}
                {th('channel', 'DOM CHANNEL', 'Largest |₹ cr| channel contribution', '', 'channel')}
                {th('beta', 'β TOT', 'Total AI beta: d ln P / d ln SOX along the typical joint path', 'num', 'beta_total')}
                {th('beta_dn', 'β DN', 'Same on worst-5% SOX days', 'num', 'downside_beta')}
                {th('market', 'MKT-IMPLIED', 'Layer 2: regression-implied move', 'num', 'market_implied')}
                {th('fund_g', 'FUND GROSS', 'Layer 3: (1−EaR)(1−d) − 1', 'num', 'fundamental')}
                {th('fund_n', 'FUND NET FX', 'Layer 3 + 4: net of INR depreciation benefit', 'num', 'fx_offset')}
                {th('gap', 'GAP', 'Market − fundamental (negative = sentiment overreaction)', 'num', 'gap')}
                {th('prem', 'AI PREM', 'Current P/E ÷ median P/E in the 3y before 30-Nov-2022, minus 1', 'num', 'ai_premium')}
                {th('p5', 'LOW P5', 'Monte Carlo 5th percentile', 'num', 'range')}
                {th('p50', 'BASE P50', 'Monte Carlo median', 'num', 'monte_carlo')}
                {th('p95', 'HIGH P95', 'Monte Carlo 95th percentile', 'num')}
                {th('mcap', 'ΔMCAP ₹ CR', 'Market-implied move × market cap', 'num', 'crore')}
                {th('conf', 'CONF', 'Confidence score: R², assumption share, sample size', 'num', 'confidence')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rg = rangeFor(r, staleMc);
                return (
                  <tr
                    key={r.ticker}
                    className={sel?.ticker === r.ticker ? 'sel' : ''}
                    onClick={() => actions.select(r.ticker)}
                    onDoubleClick={() => actions.go(r.display)}
                    title={(r.notes ?? []).join('\n') || undefined}
                  >
                    <td className="num muted">{rankOf.get(r.ticker)}</td>
                    <td className="lbl">{r.display}</td>
                    <td className="name-cell">{r.name}</td>
                    <td style={{ color: CHART_COLORS.tiers[r.tier] }}>{r.tier}</td>
                    <td>{CHANNEL_LABEL[r.dominant_channel] ?? r.dominant_channel}</td>
                    <td className="num">{num(r.beta_total, 2)}</td>
                    <td className="num">{num(r.beta_total_down, 2)}</td>
                    <td className={`num ${signClass(r.market_move)}`}>{spct(r.market_move)}</td>
                    <td className={`num ${signClass(r.fundamental_gross)}`}>{spct(r.fundamental_gross)}</td>
                    <td className={`num ${signClass(r.fundamental_net)}`}>{spct(r.fundamental_net)}</td>
                    <td className={`num ${signClass(r.gap)}`}>{spct(r.gap)}</td>
                    <td className="num">
                      {spct(r.ai_premium, 0)}
                      {isNum(r.ai_premium) && <StatusBadge status={r.ai_premium_status} />}
                    </td>
                    <td className={`num ${rg?.stale ? 'muted' : signClass(rg?.p5)}`}>{rg ? spct(rg.p5) : '—'}</td>
                    <td className={`num ${rg?.stale ? 'muted' : signClass(rg?.p50)}`}>{rg ? spct(rg.p50) : '—'}</td>
                    <td className={`num ${rg?.stale ? 'muted' : signClass(rg?.p95)}`}>{rg ? spct(rg.p95) : '—'}</td>
                    <td className={`num ${signClass(r.mcap_change_inr_cr)}`}>{crore(r.mcap_change_inr_cr)}</td>
                    <td className={`num conf-${r.confidence.grade.toLowerCase()}`} title={`R² ${num(r.confidence.r2, 2)} · assumption share ${pct(r.confidence.assumption_share, 0)} · n ${r.confidence.n}`}>
                      {r.confidence.grade} {r.confidence.score.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel-foot muted">
          Click a row to select · double-click for the security page · GAP &lt; 0 ⇒ market-implied fall exceeds modelled fundamental damage.
          {staleMc && ' Grey ranges are from the previous Monte Carlo (stale).'}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            TREEMAP — SIZE |ΔMCAP ₹ CR|, COLOUR = MARKET-IMPLIED MOVE <HelpChip id="mcap" />
          </div>
          <Treemap rows={filtered} onPick={(t) => actions.select(t)} />
        </div>
        <div className="panel">
          <div className="panel-header">
            MONTE CARLO FAN — {sel ? `${sel.display} (${sel.ticker})` : '—'} <HelpChip id="monte_carlo" /> <span className="spacer" />
            {mcForFan && !state.mc && <span className="muted">STALE</span>}
          </div>
          <FanChart mc={mcForFan} ticker={sel?.ticker ?? null} display={sel?.display ?? ''} />
          {sel && fanTicker !== sel.ticker && !state.mcRunning && (
            <div className="panel-body">
              <button className="btn" onClick={() => actions.runMC(sel.ticker)}>
                RUN MONTE CARLO FAN FOR {sel.display}
              </button>
            </div>
          )}
          {sel && (
            <table className="tbl">
              <tbody>
                <tr>
                  <td className="lbl">MARKET-IMPLIED P5 / P50 / P95</td>
                  <td className="num">
                    {selMc ? `${spct(selMc.market.p5)} / ${spct(selMc.market.p50)} / ${spct(selMc.market.p95)}` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="lbl">FUNDAMENTAL P5 / P50 / P95</td>
                  <td className="num">
                    {selMc?.fundamental ? `${spct(selMc.fundamental.p5)} / ${spct(selMc.fundamental.p50)} / ${spct(selMc.fundamental.p95)}` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="lbl">DETERMINISTIC (BASE PARAMS)</td>
                  <td className="num">
                    MKT <span className={signClass(sel.market_move)}>{spct(sel.market_move)}</span> · FUND NET{' '}
                    <span className={signClass(sel.fundamental_net)}>{spct(sel.fundamental_net)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
