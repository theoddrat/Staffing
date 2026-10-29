// ② Who gets hit: a summary strip (India value at stake, Nifty, US stocks, rupee), plain-language
// warnings, then one card per company sorted by fall — or a map sized by money at risk.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Tier } from '../../types/data';
import type { IndiaResult, ScenarioResult } from '../../types/engine';
import { scenarioHeadline } from '../../engine';
import { isNum } from '../../lib/format';
import Chart from '../../components/Chart';
import { Term } from '../../learn/Term';
import { Icon } from '../icons';
import { TIER_VIS } from '../visual';
import { Calculating, Callout, ChannelChip, ConfidenceDots, EmptyState, Gauge, MoveBar, ShareBar, StepNum, TierBadge, type Range } from '../ui';
import type { GuidedProps } from '../types';
import { GC, inkOn, moveColor } from '../chartTheme';
import { gapInfo, topReasons } from '../lib/explain';
import { pct, pctAbs, rupeesCr } from '../lib/format';
import { headlineText, indiaMcapTotal, isFlat } from '../lib/headline';
import { filterTier, SORT_LABEL, sortCompanies, type SortKey } from '../lib/sort';

const TIERS: Tier[] = ['A', 'B', 'C', 'D'];

function SummaryStrip({ result, usdInr }: { result: ScenarioResult; usdInr: number }) {
  const f = result.factors;
  const tot = result.totals.india_mcap_change_inr_cr;
  const base = indiaMcapTotal(result);
  const share = base && isNum(tot) ? tot / base : null;
  const after = isNum(usdInr) ? usdInr * (1 + f.inr_depr) : null;
  return (
    <div className="g-strip">
      <section className="g-tile is-hero" aria-labelledby="t-india">
        <h3 id="t-india" className="g-tile-label">
          <Icon name="rupee" size={16} /> What these {result.india.length} Indian companies could lose
        </h3>
        <p className="g-tile-value">{isNum(tot) && Math.abs(tot) >= 1 ? rupeesCr(tot) : 'No change'}</p>
        <ShareBar x={share} label={`${pctAbs(share, 1)} of their combined market value`} />
        <p className="g-tile-note">
          about {pctAbs(share, 1)} of their combined {rupeesCr(base)} <Term id="mcap">market value</Term>
        </p>
      </section>
      <section className="g-tile" aria-labelledby="t-nifty">
        <h3 id="t-nifty" className="g-tile-label">
          <Term id="nifty">Nifty 50</Term>
        </h3>
        <div className="g-tile-gauge">
          <Gauge value={f.NIFTY} min={-0.3} max={0.3} fillFromZero label={`Nifty 50 ${pct(f.NIFTY)}`} />
          <p className="g-tile-value is-small">{pct(f.NIFTY)}</p>
        </div>
        <p className="g-tile-note">India’s main share index</p>
      </section>
      <section className="g-tile" aria-labelledby="t-us">
        <h3 id="t-us" className="g-tile-label">Where it starts: US stocks</h3>
        <div className="g-us-row">
          <span>
            <Term id="sox">Chip stocks</Term>
          </span>
          <ShareBar x={f.SOX} label={`US chip stocks ${pct(f.SOX)}`} />
          <b>{pct(f.SOX, 0)}</b>
        </div>
        <div className="g-us-row">
          <span>
            <Term id="ndx">Big tech</Term>
          </span>
          <ShareBar x={f.NDX} label={`Nasdaq-100 ${pct(f.NDX)}`} />
          <b>{pct(f.NDX, 0)}</b>
        </div>
        <p className="g-tile-note">bar = share of their value lost</p>
      </section>
      <section className="g-tile" aria-labelledby="t-inr">
        <h3 id="t-inr" className="g-tile-label">
          <Term id="inr_depr">The rupee</Term>
        </h3>
        <p className="g-tile-value is-small">
          {Math.abs(f.inr_depr) < 0.0005 ? 'Barely moves' : `${f.inr_depr > 0 ? 'Weakens' : 'Strengthens'} ${pctAbs(f.inr_depr, 1)}`}
        </p>
        {after !== null && (
          <p className="g-tile-note">
            $1 = ₹{after.toFixed(2)} (now ₹{usdInr.toFixed(2)})
          </p>
        )}
        <p className="g-tile-note">A weaker rupee cushions IT exporters</p>
      </section>
    </div>
  );
}

function GapTag({ r }: { r: IndiaResult }) {
  const g = gapInfo(r);
  if (!g) return null;
  const pts = Math.round(g.size * 100);
  if (g.kind === 'match')
    return (
      <span className="g-gap is-match" title={g.text}>
        <Icon name="check" size={13} /> In line with business damage
      </span>
    );
  return g.kind === 'overshoot' ? (
    <span className="g-gap is-over" title={g.text}>
      <Icon name="trendDown" size={13} /> Falls {pts} points more than its business damage
    </span>
  ) : (
    <span className="g-gap is-under" title={g.text}>
      <Icon name="warning" size={13} /> Business damage {pts} points bigger than the fall
    </span>
  );
}

function CompanyCard({
  r,
  domain,
  range,
  stale,
  onOpen,
}: {
  r: IndiaResult;
  domain: [number, number];
  range: Range | null;
  stale: boolean;
  onOpen(): void;
}) {
  const money = r.mcap_change_inr_cr;
  return (
    <article className="g-co">
      <h3 className="g-co-head">
        <button type="button" className="g-co-link" onClick={onOpen}>
          <span className="g-co-name">{r.name}</span>
        </button>
        <span className="g-co-sym">{r.display}</span>
      </h3>
      <TierBadge tier={r.tier} />
      <p className="g-co-move">
        <b className="g-co-pct">{pct(r.market_move)}</b>
        {isNum(money) && Math.abs(money) >= 1 && (
          <span className="g-co-money">
            {money < 0 ? 'wipes out' : 'adds'} {rupeesCr(Math.abs(money))}
          </span>
        )}
      </p>
      <MoveBar move={r.market_move} range={range} domain={domain} stale={stale} />
      <p className="g-co-range">
        {range ? (
          <>
            9 in 10 outcomes: {pct(range.p5, 0)} to {pct(range.p95, 0)}
            {stale && <span className="g-muted"> · updating…</span>}
          </>
        ) : (
          <Calculating text="working out the likely range…" />
        )}
      </p>
      <div className="g-co-why">
        {topReasons(r).map((p) => (
          <ChannelChip key={p.channel} channel={p.channel} share={p.share} />
        ))}
      </div>
      <div className="g-co-foot">
        <ConfidenceDots grade={r.confidence.grade} />
        <GapTag r={r} />
      </div>
    </article>
  );
}

function MoneyMap({ rows, onOpen }: { rows: IndiaResult[]; onOpen(t: string): void }) {
  const option = useMemo(() => {
    const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.market_move)));
    const data = rows
      .filter((r) => isNum(r.mcap_change_inr_cr) && Math.abs(r.mcap_change_inr_cr) >= 1)
      .map((r) => {
        const c = moveColor(r.market_move, maxAbs);
        return {
          name: r.display,
          value: Math.abs(r.mcap_change_inr_cr!),
          move: r.market_move,
          money: r.mcap_change_inr_cr,
          ticker: r.ticker,
          full: r.name,
          itemStyle: { color: c },
          label: { color: inkOn(c) },
        };
      });
    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: GC.card2,
        borderColor: GC.line,
        textStyle: { color: GC.text, fontFamily: GC.sans, fontSize: 13 },
        formatter: (p: { data?: { full: string; move: number; money: number } }) =>
          p.data ? `<b>${p.data.full}</b><br/>${pct(p.data.move)} · ${p.data.money < 0 ? 'wipes out' : 'adds'} ${rupeesCr(Math.abs(p.data.money))}` : '',
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          itemStyle: { borderColor: GC.bg, borderWidth: 2, gapWidth: 2 },
          label: {
            show: true,
            fontFamily: GC.mono,
            fontSize: 12,
            formatter: (p: { name: string; data?: { move: number } }) => (p.data ? `${p.name}\n${pct(p.data.move)}` : p.name),
          },
          data,
        },
      ],
    };
  }, [rows]);
  const onClick = useCallback((p: { data?: { ticker?: string } }) => {
    if (p?.data?.ticker) onOpen(p.data.ticker);
  }, [onOpen]);
  if (!rows.some((r) => isNum(r.mcap_change_inr_cr) && Math.abs(r.mcap_change_inr_cr) >= 1))
    return <EmptyState title="Nothing to map">No company’s market value changes in this scenario.</EmptyState>;
  return (
    <figure className="g-map">
      <Chart option={option} height={440} themed={false} onClick={onClick} />
      <figcaption className="g-muted g-small">
        Box size = money at risk (₹ crore). Colour = size of the move: deeper red falls more, grey barely moves, green rises. Tap a box for
        the company’s story.
      </figcaption>
    </figure>
  );
}

export default function ImpactView({ state, actions, openCustomize }: GuidedProps) {
  const { bundle, result, params } = state;
  const [sort, setSort] = useState<SortKey>('fall');
  const [layout, setLayout] = useState<'cards' | 'map'>('cards');
  const tier = state.tierFilter;
  const rows = useMemo(() => sortCompanies(filterTier(result.india, tier), sort), [result, tier, sort]);
  const counts = useMemo(() => Object.fromEntries(TIERS.map((t) => [t, result.india.filter((r) => r.tier === t).length])) as Record<Tier, number>, [result]);

  // ranges: fresh from the Monte Carlo, or the previous ones held (faded) while it recalculates
  const held = useRef<Map<string, Range>>(new Map());
  const fresh = !!state.mc && result.india.some((r) => r.range);
  if (fresh) held.current = new Map(result.india.filter((r) => r.range).map((r) => [r.ticker, { p5: r.range!.p5, p95: r.range!.p95 }]));
  const rangeOf = (r: IndiaResult): Range | null => (r.range ? { p5: r.range.p5, p95: r.range.p95 } : held.current.get(r.ticker) ?? null);

  const domain = useMemo<[number, number]>(() => {
    const ms = result.india.map((r) => r.market_move).filter(isNum);
    const lo = Math.min(-0.02, ...ms) * 1.25;
    const hi = Math.max(0.02, Math.max(...ms, 0) * 1.25);
    return [lo, hi];
  }, [result]);

  let intro = headlineText(result);
  try {
    intro = scenarioHeadline(bundle, result);
  } catch {
    /* keep the short headline */
  }
  const flat = isFlat(result);
  const ai = bundle.history.ai_basket_pe;
  const medianFlat = flat && params.preset === 'multiple' && params.values.mode === 'median';
  const notes = result.warnings.filter((w) => !/^INFO:/i.test(w));
  const runs = state.mc?.runs ?? state.lastMc?.runs ?? null;

  return (
    <div className="g-impact">
      <div className="g-section-head">
        <StepNum n={2} />
        <div>
          <h1 className="g-h1 is-page" tabIndex={-1} data-autofocus>
            Who gets hit
          </h1>
          <p className="g-lead">{intro}</p>
        </div>
      </div>

      <SummaryStrip result={result} usdInr={bundle.meta.usd_inr} />

      {medianFlat && (
        <Callout
          tone="warn"
          title="Why nothing happens here"
          action={
            <button type="button" className="g-btn g-btn-primary" onClick={() => actions.setValue('mode', 'calibrated')}>
              Use the history-based version instead
            </button>
          }
        >
          <p>
            This version shrinks AI stocks’ <Term id="pe">price-to-earnings</Term> back to its pre-ChatGPT level. Today the AI basket trades at
            about {ai.now?.toFixed(1)}× earnings, already below its pre-ChatGPT {ai.pre_chatgpt_median?.toFixed(1)}×, so “back to normal” means
            no fall at all. The history-based version instead uses how far past bubbles fell from similar valuations.
          </p>
        </Callout>
      )}
      {flat && !medianFlat && (
        <Callout tone="info" title="This scenario barely moves anything" action={<button type="button" className="g-btn" onClick={openCustomize}>Customize</button>}>
          <p>At these settings the shock is too small to move prices. Try a stronger level or another scenario.</p>
        </Callout>
      )}
      {result.lowConfidence && (
        <Callout tone="warn" title="Treat this scenario as a rough guide">
          <p>
            It includes the <Term id="credit_event">AI-debt channel</Term>, which rests on thin data: there are few past examples of AI borrowers
            being squeezed.
          </p>
        </Callout>
      )}
      {notes.length > 0 && (
        <details className="g-notes">
          <summary>
            <Icon name="help" size={14} /> Model notes for this scenario ({notes.length})
          </summary>
          <ul>
            {notes.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="g-mc" aria-live="polite">
        {state.mcError ? (
          <span className="g-mc-err">
            <Icon name="warning" size={15} /> The range simulation failed ({state.mcError}); the likely moves are still shown.
          </span>
        ) : state.mcRunning || !state.mc ? (
          <Calculating text={`Working out likely ranges from ${runs ? runs.toLocaleString('en-IN') : 'thousands of'} simulated paths…`} />
        ) : (
          <span>
            <Icon name="dice" size={15} /> Likely ranges come from {state.mc.runs.toLocaleString('en-IN')} <Term id="monte_carlo">simulated paths</Term>.
          </span>
        )}
      </div>

      <div className="g-filters" role="group" aria-label="Filter and order the companies">
        <div className="g-pills" role="radiogroup" aria-label="Kind of company">
          <button type="button" role="radio" aria-checked={tier === 'ALL'} className={`g-pill${tier === 'ALL' ? ' is-on' : ''}`} onClick={() => actions.setTierFilter('ALL')}>
            All <small>{result.india.length}</small>
          </button>
          {TIERS.filter((t) => counts[t] > 0).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tier === t}
              className={`g-pill${tier === t ? ' is-on' : ''}`}
              onClick={() => actions.setTierFilter(t)}
              title={TIER_VIS[t].blurb}
            >
              <Icon name={TIER_VIS[t].icon} size={14} color={TIER_VIS[t].color} />
              {TIER_VIS[t].label} <small>{counts[t]}</small>
            </button>
          ))}
          <Term id="tier" />
        </div>
        <div className="g-filters-right">
          <label className="g-field is-inline">
            <span className="g-field-label">Order</span>
            <select className="g-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="g-seg" role="radiogroup" aria-label="Layout">
            <button type="button" role="radio" aria-checked={layout === 'cards'} className={layout === 'cards' ? 'is-on' : ''} onClick={() => setLayout('cards')}>
              <Icon name="layers" size={15} /> Cards
            </button>
            <button type="button" role="radio" aria-checked={layout === 'map'} className={layout === 'map' ? 'is-on' : ''} onClick={() => setLayout('map')}>
              <Icon name="target" size={15} /> Map
            </button>
          </div>
        </div>
      </div>

      {layout === 'cards' && (
        <div className="g-legend-row" aria-label="How to read a card">
          <span>
            <span className="g-leg-bar" /> likely move
          </span>
          <span>
            <span className="g-leg-whisker" /> <Term id="range">range</Term> of 9 in 10 outcomes
          </span>
          <span>
            <Icon name="pulse" size={14} /> biggest <Term id="channel">reasons</Term>
          </span>
          <span>
            <span className="g-leg-dots" /> <Term id="confidence">how much to trust it</Term>
          </span>
          <span>
            <Icon name="trendDown" size={14} /> price vs <Term id="gap">business damage</Term>
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No companies in this group">Pick another kind of company above.</EmptyState>
      ) : layout === 'map' ? (
        <MoneyMap rows={rows} onOpen={(t) => actions.setView('stock', t)} />
      ) : (
        <div className="g-cos">
          {rows.map((r) => (
            <CompanyCard key={r.ticker} r={r} domain={domain} range={rangeOf(r)} stale={!r.range && held.current.has(r.ticker)} onOpen={() => actions.setView('stock', r.ticker)} />
          ))}
        </div>
      )}

      <nav className="g-next" aria-label="Next steps">
        <button type="button" className="g-btn" onClick={() => actions.setView('flow')}>
          <StepNum n={3} /> How it spreads <Icon name="arrowRight" size={16} />
        </button>
        <button type="button" className="g-btn g-btn-ghost" onClick={() => actions.setView('history')}>
          <StepNum n={4} /> Compare with past crashes
        </button>
      </nav>
    </div>
  );
}
