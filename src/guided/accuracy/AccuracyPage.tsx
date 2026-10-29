// ⑤ How accurate is it? Every number here is out of sample: each prediction was made by a model
// fitted only on data from before the day it predicts (bundle.backtest, DESIGN §9.3).
import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { TIER_VIS } from '../visual';
import type { PanelProps } from '../../panels/types';
import type { Backtest, BacktestEvent, DataBundle, Tier } from '../../types/data';
import { isNum } from '../../lib/format';
import { fmtDate, fmtNum, pctWord } from '../../learn/data';
import { Illustration } from '../../learn/illustrations';
import { HelpChip, PageLearn, Term } from '../../learn/Term';
import {
  blendWeights,
  defaultEvent,
  eventPoints,
  eventsByDate,
  eventStats,
  hasLab,
  headline,
  inSampleR2,
  median,
  type Mode,
  modelLabel,
  nowcastRows,
  perStock,
  scoreboard,
  type Subset,
} from './accuracyUtil';

const SUBSETS: { id: Subset; label: string; blurb: string }[] = [
  { id: 'shock', label: 'Big US-chip days', blurb: 'Sessions after the worst 5% of US chip-stock days — the days this app is about.' },
  { id: 'events', label: 'Named AI shocks', blurb: 'Sessions after named events such as DeepSeek or the Super Micro auditor resignation.' },
  { id: 'all', label: 'All days', blurb: 'Every session. Most days carry little US news, so there is little to predict.' },
];

const pct0 = (x: number | null | undefined) => (isNum(x) ? `${fmtNum(x * 100, 0)}%` : '—');
const pct1 = (x: number | null | undefined) => (isNum(x) ? `${fmtNum(x * 100, 1)}%` : '—');

export default function AccuracyPage({ state, actions }: PanelProps) {
  return (
    <PageLearn state={state} actions={actions}>
      <div className="lv-page lv-acc">
        {hasLab(state.bundle) ? <Lab bundle={state.bundle} bt={state.bundle.backtest} onStock={(t) => actions.setView?.('stock', t)} /> : <LabMissing bundle={state.bundle} />}
      </div>
    </PageLearn>
  );
}

// ───────────────────────── page with results ─────────────────────────

function Lab({ bundle, bt, onStock }: { bundle: DataBundle; bt: Backtest; onStock: (ticker: string) => void }) {
  const h = headline(bt);
  return (
    <>
      <header className="lv-hero">
        <div className="lv-kicker">
          <Icon name="target" size={14} /> Accuracy lab
        </div>
        <h1 className="lv-h1">How accurate is it?</h1>
        <p className="lv-lede">
          We went back in time: from {fmtDate(h.start, true)} to {fmtDate(h.end, true)}, every {bt.refit_every} trading sessions each model
          learned from the previous {bt.train_years} years only, then predicted the next {bt.refit_every} sessions it had never seen. Below is
          how those predictions compared with what Indian stocks really did. <Term id="oos">Always out of sample</Term>
        </p>
        <p className="lv-callout">
          <Icon name="pulse" size={16} />
          <span>
            {isNum(h.hitShock) && isNum(h.r2Shock) ? (
              <>
                On the sessions after the hardest US chip-stock falls, the blend the app uses called the direction of Indian stocks right{' '}
                <b>{pct0(h.hitShock)}</b> of the time and explained about <b>{pct0(h.r2Shock)}</b> of the size of their moves
                {isNum(h.r2All) ? (
                  <>
                    {' '}
                    — against about <b>{pct0(h.r2All)}</b> on ordinary days, when moves are mostly noise
                  </>
                ) : null}
                . Useful for “which way, and roughly how hard” on shock days; not a crystal ball.
              </>
            ) : (
              'Results by model, event and stock are below.'
            )}
          </span>
        </p>
      </header>

      <section className="lv-tiles" aria-label="Headline results">
        <Tile
          title="Direction right"
          term="backtest"
          value={pct0(h.hitShock)}
          sub={`on ${h.nShock.toLocaleString('en-US')} stock-sessions after big US-chip falls`}
          visual={<HitGauge v={h.hitShock} />}
          foot="50% = coin flip"
        />
        <Tile
          title="Picks the hardest hit"
          term="r2"
          value={isNum(h.corrShock) ? fmtNum(h.corrShock, 2) : '—'}
          sub="ranking match across stocks on the same day"
          visual={<RankBar v={h.corrShock} />}
          foot="0 = random order · 1 = perfect order"
        />
        <Tile
          title="Size of moves explained"
          term="r2"
          value={pct0(h.r2Shock)}
          sub="beyond assuming “no change” (big US-chip days)"
          visual={
            <TwoBars
              a={{ label: 'big days', v: h.r2Shock }}
              b={{ label: 'all days', v: h.r2All }}
            />
          }
          foot={isNum(h.maeShock) && isNum(h.maeShockZero) ? `typical miss ${pct1(h.maeShock)} vs ${pct1(h.maeShockZero)} for “no change”` : undefined}
        />
        <Tile
          title="90% ranges held"
          term="calibration"
          value={pct0(h.cover90)}
          sub="of real outcomes landed inside the 90% range"
          visual={<DotGrid v={h.cover90} />}
          foot="target 90%"
        />
      </section>

      <Scoreboard bt={bt} />
      <EventExplorer bt={bt} bundle={bundle} onStock={onStock} />
      <div className="lv-two">
        <Calibration bt={bt} />
        <NowcastCheck bundle={bundle} />
      </div>
      <PerStock bundle={bundle} onStock={onStock} />
      <Meaning />
    </>
  );
}

function Tile({ title, term, value, sub, visual, foot }: { title: string; term: Parameters<typeof HelpChip>[0]['id']; value: string; sub: string; visual: React.ReactNode; foot?: string }) {
  return (
    <div className="lv-tile">
      <div className="lv-tile-head">
        <span>{title}</span>
        <HelpChip id={term} />
      </div>
      <div className="lv-tile-body">
        <div className="lv-tile-val">{value}</div>
        <div className="lv-tile-vis">{visual}</div>
      </div>
      <div className="lv-tile-sub">{sub}</div>
      {foot && <div className="lv-tile-foot">{foot}</div>}
    </div>
  );
}

function HitGauge({ v }: { v: number | null }) {
  const cx = 50;
  const cy = 46;
  const r = 38;
  const pt = (x: number) => {
    const a = Math.PI * (1 - x);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [x1, y1] = pt(0);
  const [x2, y2] = pt(1);
  const val = isNum(v) ? Math.max(0, Math.min(1, v)) : null;
  const [vx, vy] = val !== null ? pt(val) : [cx, cy];
  const [hx, hy] = pt(0.5);
  return (
    <svg viewBox="0 0 100 56" className="lv-mini" aria-hidden="true">
      <path d={`M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`} className="lv-g-track" />
      {val !== null && <path d={`M${x1},${y1} A${r},${r} 0 0 1 ${vx.toFixed(1)},${vy.toFixed(1)}`} className="lv-g-fill" />}
      <line x1={hx} y1={hy - 6} x2={hx} y2={hy + 6} className="lv-g-mark" />
    </svg>
  );
}

function RankBar({ v }: { v: number | null }) {
  const x = isNum(v) ? 50 + Math.max(-1, Math.min(1, v)) * 46 : null;
  return (
    <svg viewBox="0 0 100 40" className="lv-mini" aria-hidden="true">
      <rect x={4} y={16} width={92} height={8} rx={4} className="lv-g-track-f" />
      <line x1={50} y1={10} x2={50} y2={30} className="lv-g-mark" />
      {x !== null && <circle cx={x} cy={20} r={6} className="lv-g-dot" />}
      <text x={4} y={38} className="lv-mini-t">
        −1
      </text>
      <text x={50} y={38} className="lv-mini-t" textAnchor="middle">
        0
      </text>
      <text x={96} y={38} className="lv-mini-t" textAnchor="end">
        1
      </text>
    </svg>
  );
}

function TwoBars({ a, b }: { a: { label: string; v: number | null }; b: { label: string; v: number | null } }) {
  const max = Math.max(0.05, isNum(a.v) ? a.v : 0, isNum(b.v) ? b.v : 0);
  const w = (v: number | null) => (isNum(v) ? Math.max(1, (Math.max(0, v) / max) * 60) : 0);
  return (
    <svg viewBox="0 0 100 40" className="lv-mini" aria-hidden="true">
      <text x={0} y={13} className="lv-mini-t">
        {a.label}
      </text>
      <rect x={36} y={5} width={w(a.v)} height={10} rx={2} className="lv-g-bar" />
      <text x={0} y={33} className="lv-mini-t">
        {b.label}
      </text>
      <rect x={36} y={25} width={w(b.v)} height={10} rx={2} className="lv-g-bar2" />
    </svg>
  );
}

function DotGrid({ v }: { v: number | null }) {
  const k = isNum(v) ? Math.round(v * 100) : 0;
  return (
    <svg viewBox="0 0 100 50" className="lv-mini" aria-hidden="true">
      {Array.from({ length: 100 }, (_, i) => (
        <rect key={i} x={2 + (i % 20) * 4.8} y={2 + Math.floor(i / 20) * 9.6} width={3.6} height={7.4} rx={1} className={i < k ? 'lv-g-in' : 'lv-g-out'} />
      ))}
    </svg>
  );
}

// ───────────────────────── scoreboard ─────────────────────────

function Scoreboard({ bt }: { bt: Backtest }) {
  const [subset, setSubset] = useState<Subset>('shock');
  const [tier, setTier] = useState<Tier | 'ALL'>('ALL');
  const rows = scoreboard(bt, 'scenario', subset);
  const ncRows = scoreboard(bt, 'nowcast', subset);
  const max = Math.max(0.05, ...rows.map((r) => r.r2), ...ncRows.map((r) => r.r2));
  const min = Math.min(0, ...rows.map((r) => r.r2), ...ncRows.map((r) => r.r2));
  const blend = blendWeights(bt, tier === 'ALL' ? undefined : tier);
  const tiers = (['A', 'B', 'C', 'D'] as Tier[]).filter((t) => bt.ensemble.weights_by_tier?.[t]);
  const info = SUBSETS.find((s) => s.id === subset)!;
  return (
    <section className="lv-card lv-section" aria-labelledby="acc-score">
      <h2 className="lv-h2" id="acc-score">
        <Icon name="layers" size={18} /> Which model predicts best?
      </h2>
      <p className="lv-muted">
        Each bar is the share of the moves a model explained on days it had never seen, compared with simply assuming “no change”. Longer is better;
        below zero means worse than doing nothing. <HelpChip id="r2" />
      </p>
      <div className="lv-tabs" role="tablist" aria-label="Which days">
        {SUBSETS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={subset === s.id} className={`lv-tab${subset === s.id ? ' on' : ''}`} onClick={() => setSubset(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="lv-hint">{info.blurb}</p>
      <ScoreBars rows={rows} min={min} max={max} />
      <div className="lv-blend">
        <div className="lv-blend-head">
          <h3 className="lv-h3">
            What the app’s blend is made of <HelpChip id="ensemble" />
          </h3>
          {tiers.length > 0 && (
            <div className="lv-chips" role="group" aria-label="Weights for">
              {(['ALL', ...tiers] as (Tier | 'ALL')[]).map((t) => (
                <button key={t} type="button" className={`lv-chipbtn${tier === t ? ' on' : ''}`} aria-pressed={tier === t} onClick={() => setTier(t)}>
                  {t === 'ALL' ? 'All stocks' : `Tier ${t}`}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="lv-stack" role="img" aria-label={blend.map((p) => `${p.label} ${pct0(p.weight)}`).join(', ')}>
          {blend.map((p, i) => (
            <span key={p.id} className={`lv-stack-seg s${i % 6}${p.id === 'zero' ? ' zero' : ''}`} style={{ width: `${p.weight * 100}%` }} title={`${p.label}: ${pct0(p.weight)}`} />
          ))}
        </div>
        <ul className="lv-legend">
          {blend.map((p, i) => (
            <li key={p.id}>
              <span className={`lv-sw s${i % 6}${p.id === 'zero' ? ' zero' : ''}`} />
              <b>{p.label}</b> {pct0(p.weight)} — <span className="lv-muted">{p.note}</span>
            </li>
          ))}
        </ul>
        <p className="lv-hint">{bt.ensemble.method}</p>
      </div>
      {ncRows.length > 0 && (
        <details className="lv-details">
          <summary>
            With morning clues (a check, not used for scenarios) <HelpChip id="nowcast" />
          </summary>
          <p className="lv-muted">
            These models also see what happened overnight and in Asia before the Indian close: US-listed India funds, ADRs, Taiwan and Korea. They do
            better, but mostly because the move has already started at the open — you could not trade on it at the previous close, and a what-if
            scenario cannot know it.
          </p>
          <ScoreBars rows={ncRows} min={min} max={max} />
        </details>
      )}
    </section>
  );
}

function ScoreBars({ rows, min, max }: { rows: ReturnType<typeof scoreboard>; min: number; max: number }) {
  const span = max - min || 1;
  const zeroAt = ((0 - min) / span) * 100;
  return (
    <ol className="lv-bars">
      {rows.map((r) => {
        const left = r.r2 >= 0 ? zeroAt : ((r.r2 - min) / span) * 100;
        const width = (Math.abs(r.r2) / span) * 100;
        return (
          <li key={r.id} className={`lv-bar-row${r.usedByApp ? ' used' : ''}${r.baseline ? ' base' : ''}`} title={r.description}>
            <div className="lv-bar-label">
              <span>{r.label}</span>
              {r.usedByApp && <span className="lv-badge">used by the app</span>}
              {r.baseline && <span className="lv-badge lv-badge-muted">the bar to beat</span>}
            </div>
            <div className="lv-bar-track">
              <span className="lv-bar-zero" style={{ left: `${zeroAt}%` }} />
              {!r.baseline && <span className={`lv-bar-fill${r.r2 < 0 ? ' neg' : ''}`} style={{ left: `${left}%`, width: `${Math.max(0.6, width)}%` }} />}
            </div>
            <div className="lv-bar-val">
              <span className="lv-num">{r.baseline ? '0%' : pct1(r.r2)}</span>
              <span className="lv-bar-sub">{isNum(r.hit) ? `direction ${pct0(r.hit)}` : 'never calls a direction'}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────── event explorer ─────────────────────────

function EventExplorer({ bt, bundle, onStock }: { bt: Backtest; bundle: DataBundle; onStock: (t: string) => void }) {
  const evs = eventsByDate(bt);
  const [sel, setSel] = useState<string | null>(defaultEvent(bt)?.id ?? null);
  const [all, setAll] = useState(false);
  const ev = evs.find((e) => e.id === sel) ?? evs[0] ?? null;
  if (!ev) return null;
  const st = eventStats(ev);
  const pts = eventPoints(ev).sort((a, c) => a.actual - c.actual);
  const shown = all ? pts : pts.slice(0, 8);
  return (
    <section className="lv-card lv-section" aria-labelledby="acc-events">
      <h2 className="lv-h2" id="acc-events">
        <Icon name="clock" size={18} /> Past shocks: predicted vs what really happened <HelpChip id="backtest" />
      </h2>
      <p className="lv-muted">
        Pick a past shock. Each dot is one Indian stock on the session after it: across is what the blend predicted beforehand, up is what really
        happened. Dots on the dashed line were spot on; the grey whisker is the 90% range given in advance.
      </p>
      <div className="lv-evlist" role="listbox" aria-label="Past shocks">
        {evs.map((e) => {
          const s = eventStats(e);
          return (
            <button key={e.id} type="button" role="option" aria-selected={e.id === ev.id} className={`lv-ev${e.id === ev.id ? ' on' : ''}`} onClick={() => setSel(e.id)}>
              <span className="lv-ev-date">{fmtDate(e.india_date)}</span>
              <span className="lv-ev-label">{e.kind === 'named' ? e.label : `US chips ${pctWord(Math.exp(e.x_sox) - 1)}`}</span>
              <span className="lv-ev-hit" aria-hidden="true">
                <span style={{ width: `${isNum(s.hit) ? s.hit * 100 : 0}%` }} />
              </span>
              <span className="lv-ev-hitn">{isNum(s.hit) ? `${pct0(s.hit)} right way` : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="lv-evbody">
        <div className="lv-evchart">
          <EventScatter ev={ev} />
        </div>
        <div className="lv-evstats">
          <h3 className="lv-h3">{ev.label}</h3>
          <p className="lv-muted">
            US move that reached India on {fmtDate(ev.india_date)}: chips {pctWord(Math.exp(ev.x_sox) - 1)}, Nasdaq-100 {pctWord(Math.exp(ev.x_ndx) - 1)}.
          </p>
          <dl className="lv-dl">
            <div>
              <dt>Direction right</dt>
              <dd>{isNum(st.hit) ? `${pct0(st.hit)} of stocks` : '—'}</dd>
            </div>
            <div>
              <dt>Typical miss</dt>
              <dd>{isNum(st.mae) ? `${pct1(st.mae)}${isNum(st.maeZero) ? ` (no change: ${pct1(st.maeZero)})` : ''}` : '—'}</dd>
            </div>
            <div>
              <dt>Ranking match</dt>
              <dd>{isNum(st.corr) ? fmtNum(st.corr, 2) : '—'}</dd>
            </div>
            <div>
              <dt>Inside the 90% range</dt>
              <dd>{st.withBand ? `${st.inside} of ${st.withBand}` : '—'}</dd>
            </div>
            <div>
              <dt>Average stock</dt>
              <dd>
                predicted {pctWord(st.meanPred)}, actual {pctWord(st.meanActual)}
              </dd>
            </div>
          </dl>
          {isNum(st.corr) && st.corr < 0.05 && (
            <p className="lv-warn">
              <Icon name="warning" size={14} /> On this day the model got the general direction but not which stocks would fall most — company news
              and local factors dominated.
            </p>
          )}
        </div>
      </div>
      <table className="lv-table">
        <caption className="lv-sr">Predicted and actual moves for {ev.label}</caption>
        <thead>
          <tr>
            <th scope="col">Stock</th>
            <th scope="col">Predicted</th>
            <th scope="col">Actual</th>
            <th scope="col">In 90% range</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.ticker}>
              <td>
                <button type="button" className="lv-link" onClick={() => onStock(p.ticker)}>
                  <span className="lv-tierdot" style={{ background: TIER_VIS[p.tier].color }} />
                  {p.display}
                </button>
              </td>
              <td className="lv-num">{pctWord(p.pred)}</td>
              <td className={`lv-num ${p.actual < 0 ? 'dn' : 'up'}`}>{pctWord(p.actual)}</td>
              <td>{p.inside === null ? '—' : p.inside ? <Icon name="check" size={14} title="inside" /> : <Icon name="close" size={14} title="outside" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pts.length > 8 && (
        <button type="button" className="lv-more" onClick={() => setAll((x) => !x)}>
          {all ? 'Show the 8 biggest falls' : `Show all ${pts.length} stocks`}
        </button>
      )}
      <p className="lv-hint">Moves are for the Indian session after the US close; {bundle.india.length - pts.length > 0 ? 'stocks without enough history at the time are left out.' : 'every stock had enough history.'}</p>
    </section>
  );
}

function EventScatter({ ev }: { ev: BacktestEvent }) {
  const pts = eventPoints(ev);
  const W = 360;
  const H = 300;
  const L = 44;
  const R = W - 12;
  const T = 14;
  const B = H - 40;
  const vals = pts.flatMap((p) => [p.pred, p.actual, ...(p.lo !== null ? [p.lo] : []), ...(p.hi !== null ? [p.hi] : [])]);
  const lo = Math.min(-0.02, ...vals);
  const hi = Math.max(0.02, ...vals);
  const pad = (hi - lo) * 0.06;
  const d0 = lo - pad;
  const d1 = hi + pad;
  const sx = (v: number) => L + ((v - d0) / (d1 - d0)) * (R - L);
  const sy = (v: number) => B - ((v - d0) / (d1 - d0)) * (B - T);
  const step = niceStep((d1 - d0) / 5);
  const ticks: number[] = [];
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + 1e-12; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lv-chart" role="img" aria-label={`${ev.label}: predicted against actual moves for ${pts.length} stocks`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} y1={sy(t)} x2={R} y2={sy(t)} className={t === 0 ? 'lv-ax0' : 'lv-gridline'} />
          <line x1={sx(t)} y1={T} x2={sx(t)} y2={B} className={t === 0 ? 'lv-ax0' : 'lv-gridline'} />
          <text x={L - 6} y={sy(t) + 3} className="lv-tick" textAnchor="end">
            {fmtNum(t * 100, 0)}%
          </text>
          <text x={sx(t)} y={B + 14} className="lv-tick" textAnchor="middle">
            {fmtNum(t * 100, 0)}%
          </text>
        </g>
      ))}
      <line x1={sx(d0)} y1={sy(d0)} x2={sx(d1)} y2={sy(d1)} className="lv-diag" />
      {pts.map((p) =>
        p.lo !== null && p.hi !== null ? <line key={`w${p.ticker}`} x1={sx(p.pred)} y1={sy(p.lo)} x2={sx(p.pred)} y2={sy(p.hi)} className="lv-whisk" /> : null,
      )}
      {pts.map((p) => (
        <circle key={p.ticker} cx={sx(p.pred)} cy={sy(p.actual)} r={4.2} className={`lv-pt${p.inside === false ? ' out' : ''}`} style={{ fill: TIER_VIS[p.tier].color }}>
          <title>{`${p.display}: predicted ${pctWord(p.pred)}, actual ${pctWord(p.actual)}${p.inside === false ? ' (outside the 90% range)' : ''}`}</title>
        </circle>
      ))}
      <text x={(L + R) / 2} y={H - 8} className="lv-axl" textAnchor="middle">
        predicted the evening before →
      </text>
      <text x={12} y={(T + B) / 2} className="lv-axl" textAnchor="middle" transform={`rotate(-90 12 ${(T + B) / 2})`}>
        what really happened →
      </text>
    </svg>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

// ───────────────────────── calibration, nowcast, per stock ─────────────────────────

function Calibration({ bt }: { bt: Backtest }) {
  const rows = bt.calibration.filter((c) => isNum(c.nominal) && isNum(c.coverage));
  return (
    <section className="lv-card lv-section" aria-labelledby="acc-cal">
      <h2 className="lv-h2" id="acc-cal">
        <Icon name="check" size={18} /> Do the ranges hold? <HelpChip id="calibration" />
      </h2>
      <p className="lv-muted">A range that claims 90% should catch about 9 in 10 real outcomes. The white tick is the target.</p>
      <ul className="lv-cal">
        {rows.map((c) => {
          const good = Math.abs(c.coverage - c.nominal) <= 0.03;
          return (
            <li key={c.nominal}>
              <span className="lv-cal-l">{pct0(c.nominal)} range</span>
              <span className="lv-cal-track">
                <span className={`lv-cal-fill${good ? ' good' : ''}`} style={{ width: `${Math.min(1, c.coverage) * 100}%` }} />
                <span className="lv-cal-tick" style={{ left: `${c.nominal * 100}%` }} />
              </span>
              <span className="lv-num">{pct1(c.coverage)}</span>
            </li>
          );
        })}
      </ul>
      <p className="lv-hint">{rows[0] ? `Checked on ${rows[0].n.toLocaleString('en-US')} stock-sessions the model had not seen.` : ''}</p>
    </section>
  );
}

function NowcastCheck({ bundle }: { bundle: DataBundle }) {
  const nc = bundle.nowcast;
  const rows = nowcastRows(bundle);
  if (!nc) return null;
  const vals = rows.flatMap((r) => [r.pred, ...(r.lo !== null ? [r.lo] : []), ...(r.hi !== null ? [r.hi] : []), ...(r.actual !== null ? [r.actual] : [])]);
  const m = Math.max(0.01, ...vals.map(Math.abs));
  const x = (v: number) => 50 + (v / m) * 48;
  const nifty = nc.nifty;
  return (
    <section className="lv-card lv-section" aria-labelledby="acc-now">
      <h2 className="lv-h2" id="acc-now">
        <Icon name="clock" size={18} /> Tomorrow’s model check <HelpChip id="nowcast" />
      </h2>
      <p className="lv-muted">
        For the session of <b>{fmtDate(nc.for_india_date)}</b>, from clues known after the US close of {fmtDate(nc.us_date)}.
      </p>
      {nifty && isNum(nifty.pred) && (
        <p className="lv-big">
          Nifty 50: <span className="lv-num">{pctWord(Math.exp(nifty.pred) - 1, 2)}</span>
          {isNum(nifty.lo90) && isNum(nifty.hi90) && (
            <span className="lv-muted">
              {' '}
              (90% range {pctWord(Math.exp(nifty.lo90) - 1, 1)} to {pctWord(Math.exp(nifty.hi90) - 1, 1)})
            </span>
          )}
          {isNum(nifty.actual) && <span> · actual {pctWord(Math.exp(nifty.actual as number) - 1, 2)}</span>}
        </p>
      )}
      <ul className="lv-whiskers" aria-label="Predicted next-session moves with 90% ranges">
        {rows.map((r) => (
          <li key={r.ticker}>
            <span className="lv-wh-l">{r.display}</span>
            <span className="lv-wh-track">
              <span className="lv-wh-zero" />
              {r.lo !== null && r.hi !== null && <span className="lv-wh-band" style={{ left: `${x(r.lo)}%`, width: `${x(r.hi) - x(r.lo)}%` }} />}
              <span className="lv-wh-dot" style={{ left: `${x(r.pred)}%` }} />
              {r.actual !== null && <span className="lv-wh-act" style={{ left: `${x(r.actual)}%` }} />}
            </span>
            <span className="lv-num">{pctWord(r.pred, 2)}</span>
          </li>
        ))}
      </ul>
      <p className="lv-warn">
        <Icon name="warning" size={14} /> {nc.note}
      </p>
    </section>
  );
}

function PerStock({ bundle, onStock }: { bundle: DataBundle; onStock: (t: string) => void }) {
  const rows = useMemo(() => perStock(bundle), [bundle]);
  const tested = rows.filter((r) => r.tested && isNum(r.r2Shock));
  const max = Math.max(0.05, ...tested.map((r) => r.r2Shock as number), ...tested.map((r) => (isNum(r.r2All) ? r.r2All : 0)));
  const medShock = median(tested.map((r) => r.r2Shock as number));
  return (
    <section className="lv-card lv-section" aria-labelledby="acc-stock">
      <h2 className="lv-h2" id="acc-stock">
        <Icon name="people" size={18} /> Stock by stock
      </h2>
      <p className="lv-muted">
        How much of each stock’s moves the blend explained on unseen days: amber on big US-chip days, grey on all days.
        {isNum(medShock) ? ` The typical stock: ${pct0(medShock)} on big days.` : ''} Stocks with a tighter real link to US AI stocks are easier to
        predict.
      </p>
      <ol className="lv-sbars">
        {rows.map((r) => (
          <li key={r.ticker}>
            <button type="button" className="lv-link lv-sb-l" onClick={() => onStock(r.ticker)} title={r.name}>
              <span className="lv-tierdot" style={{ background: TIER_VIS[r.tier].color }} />
              {r.display}
            </button>
            {r.tested ? (
              <span className="lv-sb-track">
                <span className="lv-sb-a" style={{ width: `${(Math.max(0, isNum(r.r2Shock) ? r.r2Shock : 0) / max) * 100}%` }} />
                <span className="lv-sb-b" style={{ width: `${(Math.max(0, isNum(r.r2All) ? r.r2All : 0) / max) * 100}%` }} />
              </span>
            ) : (
              <span className="lv-sb-na" title="Listed too recently to have out-of-sample history; no accuracy figure is shown.">
                too new to test
              </span>
            )}
            <span className="lv-num lv-sb-v">{r.tested && isNum(r.r2Shock) ? pct0(r.r2Shock) : ''}</span>
            <span className="lv-sb-c" title="share of real moves inside the 90% range">
              {r.tested && isNum(r.cover90) ? `${pct0(r.cover90)} in range` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Meaning() {
  return (
    <section className="lv-card lv-section" aria-labelledby="acc-mean">
      <h2 className="lv-h2" id="acc-mean">
        <Icon name="book" size={18} /> What these numbers mean
      </h2>
      <div className="lv-meaning">
        <div>
          <Illustration id="oos" bundle={null} result={null} compact />
          <p>
            <Term id="oos">Out of sample</Term>: every prediction was made before the day it predicts, by a model that never saw that day.
          </p>
        </div>
        <div>
          <Illustration id="r2" bundle={null} result={null} compact />
          <p>
            <Term id="r2">Explained share</Term> sounds small because daily prices are noisy. On big shock days, where the US link matters, it is
            several times higher.
          </p>
        </div>
        <div>
          <Illustration id="ensemble" bundle={null} result={null} compact />
          <p>
            <Term id="ensemble">The blend</Term> weighs models by how well they did before; it can also lean toward “no change”, which helps when
            moves are mostly noise.
          </p>
        </div>
        <div>
          <Illustration id="calibration" bundle={null} result={null} compact />
          <p>
            <Term id="calibration">Ranges</Term> are only useful if they hold: a 90% range that catches 89% of outcomes is close to honest.
          </p>
        </div>
      </div>
      <p className="lv-warn">
        <Icon name="warning" size={14} /> Past accuracy does not guarantee future accuracy, and a scenario is a what-if, not a forecast.
      </p>
    </section>
  );
}

// ───────────────────────── empty state ─────────────────────────

function LabMissing({ bundle }: { bundle: DataBundle }) {
  const r2 = inSampleR2(bundle);
  const med = median(r2.map((x) => x.r2));
  const max = Math.max(0.05, ...r2.map((x) => x.r2));
  return (
    <>
      <header className="lv-hero">
        <div className="lv-kicker">
          <Icon name="target" size={14} /> Accuracy lab
        </div>
        <h1 className="lv-h1">How accurate is it?</h1>
        <p className="lv-lede">
          The accuracy lab tests every model on days it has never seen. It has not been run for this data build yet, so no out-of-sample results are
          shown. <Term id="oos">What out of sample means</Term>
        </p>
      </header>
      <section className="lv-card lv-section">
        <Illustration id="oos" bundle={bundle} result={null} />
      </section>
      {r2.length > 0 && (
        <section className="lv-card lv-section" aria-labelledby="acc-ins">
          <h2 className="lv-h2" id="acc-ins">
            Meanwhile: how well the current fit matches the past <HelpChip id="r2" />
          </h2>
          <p className="lv-warn">
            <Icon name="warning" size={14} /> In-sample only — measured on the same three years the model learned from, so it flatters the model.
          </p>
          <p className="lv-muted">{isNum(med) ? `Median stock: ${pct0(med)} of daily moves explained.` : ''}</p>
          <ol className="lv-sbars">
            {r2.map((x) => (
              <li key={x.display}>
                <span className="lv-sb-l">
                  <span className="lv-tierdot" style={{ background: TIER_VIS[x.tier].color }} />
                  {x.display}
                </span>
                <span className="lv-sb-track">
                  <span className="lv-sb-b" style={{ width: `${(x.r2 / max) * 100}%` }} />
                </span>
                <span className="lv-num lv-sb-v">{pct0(x.r2)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

export { modelLabel };
export type { Mode };
