// A company's story: the headline, the likely move with its range, why (market channels), what the
// business numbers say, the gap between the two, how sure we are (with past shock days), key facts
// with provenance, and its price since 2021 with the ChatGPT launch marked.
import { useMemo } from 'react';
import type { DataBundle, IndiaTarget, Security } from '../../types/data';
import type { IndiaResult, ScenarioResult } from '../../types/engine';
import { isNum } from '../../lib/format';
import Chart from '../../components/Chart';
import { HelpChip, Term } from '../../learn/Term';
import { Icon } from '../icons';
import { TIER_VIS } from '../visual';
import { Calculating, Callout, ChannelKey, ConfidenceDots, DivergingStack, EmptyState, GBadge, Gauge, MoveBar, Sources, TierBadge } from '../ui';
import type { GuidedProps } from '../types';
import { GC } from '../chartTheme';
import { businessParts, gapInfo, getExplanation, marketParts, reasonText, type Part, type PartChannel } from '../lib/explain';
import { HORIZON_WORDS, pct, pctAbs, rupeesCr } from '../lib/format';
import { sortCompanies } from '../lib/sort';

const CHATGPT = '2022-11-30';

function Meter({ x, label }: { x: number; label: string }) {
  return (
    <span className="g-meter" role="img" aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(1, x)) * 100}%` }} />
    </span>
  );
}

function Hero({ r, horizon }: { r: IndiaResult; horizon: ScenarioResult['params']['horizon'] }) {
  const q = r.range;
  const lo0 = Math.min(q?.p5 ?? r.market_move, r.market_move, -0.05);
  const hi0 = Math.max(q?.p95 ?? r.market_move, r.market_move, 0.05);
  const padv = (hi0 - lo0) * 0.06;
  const domain: [number, number] = [Math.max(-1, lo0 - padv), hi0 + padv];
  const z = ((0 - domain[0]) / (domain[1] - domain[0])) * 100;
  const money = r.mcap_change_inr_cr;
  return (
    <section className="g-card g-stock-hero" aria-label="Likely move">
      <p className="g-hero-label">Likely move {HORIZON_WORDS[horizon]}</p>
      <p className={`g-hero-num ${r.market_move < 0 ? 'is-neg' : 'is-pos'}`}>{pct(r.market_move)}</p>
      {isNum(money) && isNum(r.mcap_inr_cr) && (
        <p className="g-hero-money">
          {money < 0 ? 'wipes out' : 'adds'} about <b>{rupeesCr(Math.abs(money))}</b> of its {rupeesCr(r.mcap_inr_cr)} <Term id="mcap">market value</Term>
        </p>
      )}
      <MoveBar big move={r.market_move} range={q ? { p5: q.p5, p95: q.p95 } : null} domain={domain} />
      <div className="g-move-scale" aria-hidden="true">
        <span style={{ left: '0%' }}>{pct(domain[0], 0)}</span>
        <span style={{ left: `${z}%` }}>0</span>
        <span style={{ left: '100%' }}>{pct(domain[1], 0)}</span>
      </div>
      {q ? (
        <p className="g-hero-range">
          <Icon name="dice" size={15} /> In 9 of 10 <Term id="monte_carlo">simulated paths</Term> the move lands between <b>{pct(q.p5, 0)}</b> and{' '}
          <b>{pct(q.p95, 0)}</b>. The dot is the most likely value.
        </p>
      ) : (
        <p className="g-hero-range">
          <Calculating text="Simulating thousands of paths to find the likely range…" />
        </p>
      )}
    </section>
  );
}

function PartRows({ parts, text }: { parts: Part[]; text(ch: PartChannel): string }) {
  return (
    <ul className="g-reasons">
      {parts.map((p) => (
        <li key={p.channel}>
          <div className="g-reason-head">
            <ChannelKey channel={p.channel} label={p.channel === 'fx' && p.frac < 0 ? 'A weaker rupee raises its costs' : undefined} />
            <b className="g-reason-val">{p.inr_cr !== null ? rupeesCr(p.inr_cr, { sign: true }) : pct(p.frac)}</b>
          </div>
          <p className="g-reason-text">{text(p.channel)}</p>
          <p className="g-reason-share">
            {p.frac < 0 ? 'pushes the price down' : 'holds the price up'} · {pctAbs(p.share)} of the total effect
          </p>
        </li>
      ))}
    </ul>
  );
}

function PriceVsBusiness({ r }: { r: IndiaResult }) {
  const g = gapInfo(r);
  if (!isNum(r.fundamental_net) || !g) return null;
  const a = r.market_move;
  const b = r.fundamental_net;
  const lo = Math.min(a, b, -0.02) * 1.15;
  const hi = Math.max(a, b, 0.02) * 1.15;
  const pos = (x: number) => ((x - lo) / (hi - lo)) * 100;
  const bar = (x: number, cls: string, label: string) => (
    <div className="g-pvb-row">
      <span className="g-pvb-label">{label}</span>
      <span className="g-pvb-track" role="img" aria-label={`${label}: ${pct(x)}`}>
        <span className="g-pvb-zero" style={{ left: `${pos(0)}%` }} />
        <span className={`g-pvb-bar ${cls} ${x < 0 ? 'is-neg' : 'is-pos'}`} style={{ left: `${Math.min(pos(0), pos(x))}%`, width: `${Math.abs(pos(x) - pos(0))}%` }} />
      </span>
      <b className="g-pvb-val">{pct(x)}</b>
    </div>
  );
  return (
    <section className="g-card" aria-labelledby="pvb">
      <h2 id="pvb" className="g-h2">
        <Icon name="target" size={20} /> Price move vs business damage <HelpChip id="gap" />
      </h2>
      {bar(a, 'is-market', 'What prices would likely do')}
      {bar(b, 'is-fund', 'What the business numbers justify')}
      <p className={`g-pvb-say is-${g.kind}`}>
        <Icon name={g.kind === 'match' ? 'check' : g.kind === 'overshoot' ? 'trendDown' : 'warning'} size={16} /> {g.text}.
      </p>
      <p className="g-muted g-small">
        The first bar is <Term id="market_implied">market-implied</Term>: how this share has moved on similar days. The second is{' '}
        <Term id="fundamental">fundamental</Term>: lost earnings, a fading AI premium and the rupee. A big gap means mood and money flows, not
        the company’s own numbers, drive most of the move.
      </p>
    </section>
  );
}

interface Dot {
  x: number;
  y: number;
  label: string;
}

function shockDots(bundle: DataBundle, r: IndiaResult): { pts: Dot[]; mode: 'oos' | 'insample' | null } {
  const ev = bundle.backtest?.events ?? [];
  const pts: Dot[] = [];
  for (const e of ev) {
    const row = e.rows.find((x) => x.ticker === r.ticker);
    if (!row || !isNum(row.actual)) continue;
    const p = isNum(row.pred?.ensemble) ? row.pred.ensemble : Object.values(row.pred ?? {}).find(isNum);
    if (isNum(p)) pts.push({ x: Math.expm1(p), y: Math.expm1(row.actual), label: `${e.label} (${e.india_date})` });
  }
  if (pts.length) return { pts, mode: 'oos' };
  if (!isNum(r.beta_total)) return { pts: [], mode: null };
  const names = new Map(bundle.history.event_studies.map((e) => [e.id, e.label]));
  for (const p of bundle.history.us_vs_india) {
    if (p.ticker !== r.ticker || !isNum(p.x_sox) || !isNum(p.r)) continue;
    pts.push({
      x: Math.expm1(r.beta_total * p.x_sox),
      y: Math.expm1(p.r),
      label: `${p.event ? names.get(p.event) ?? 'Named shock day' : 'Big US chip-stock fall'} · ${p.date}`,
    });
  }
  return { pts, mode: pts.length ? 'insample' : null };
}

function ShockDays({ bundle, r }: { bundle: DataBundle; r: IndiaResult }) {
  const { pts, mode } = useMemo(() => shockDots(bundle, r), [bundle, r]);
  if (!mode) return null;
  const W = 320;
  const P = 34;
  const d = Math.min(0.5, Math.max(0.02, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.1);
  const px = (x: number) => P + ((x + d) / (2 * d)) * (W - 2 * P);
  const py = (y: number) => W - P - ((y + d) / (2 * d)) * (W - 2 * P);
  const hits = pts.filter((p) => Math.sign(p.x) === Math.sign(p.y)).length;
  const mae = pts.reduce((a, p) => a + Math.abs(p.x - p.y), 0) / pts.length;
  return (
    <figure className="g-dots">
      <figcaption className="g-h3">
        {mode === 'oos' ? 'Past shock days the model had not seen' : 'Past days when US chip stocks fell hard'} <HelpChip id={mode === 'oos' ? 'oos' : 'backtest'} />
      </figcaption>
      <svg viewBox={`0 0 ${W} ${W}`} className="g-dots-svg" role="img" aria-label={`Predicted vs actual on ${pts.length} past days: right direction on ${hits}`}>
        <rect x={P} y={P} width={W - 2 * P} height={W - 2 * P} className="g-dots-frame" />
        <line x1={px(-d)} y1={py(0)} x2={px(d)} y2={py(0)} className="g-dots-axis" />
        <line x1={px(0)} y1={py(-d)} x2={px(0)} y2={py(d)} className="g-dots-axis" />
        <line x1={px(-d)} y1={py(-d)} x2={px(d)} y2={py(d)} className="g-dots-diag" />
        <text
          x={px(d * 0.55) + 8}
          y={py(d * 0.55) + 8}
          textAnchor="middle"
          transform={`rotate(-45 ${px(d * 0.55) + 8} ${py(d * 0.55) + 8})`}
          className="g-dots-note"
        >
          perfect guess
        </text>
        {pts.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r={4.5} className={Math.sign(p.x) === Math.sign(p.y) ? 'g-dot is-hit' : 'g-dot'}>
            <title>{`${p.label}: model ${pct(p.x)}, actual ${pct(p.y)}`}</title>
          </circle>
        ))}
        <text x={W / 2} y={W - 8} textAnchor="middle" className="g-dots-lab">
          what the model said →
        </text>
        <text x={12} y={W / 2} textAnchor="middle" className="g-dots-lab" transform={`rotate(-90 12 ${W / 2})`}>
          what happened →
        </text>
        <text x={P} y={P - 8} className="g-dots-tick">
          {pct(d, 0)}
        </text>
        <text x={W - P} y={W - P + 14} textAnchor="end" className="g-dots-tick">
          {pct(d, 0)}
        </text>
      </svg>
      <p className="g-small">
        <span className="g-dot-key is-hit" /> right direction on <b>{hits}</b> of {pts.length} days · <span className="g-dot-key" /> wrong direction ·
        typical miss {pctAbs(mae, 1)}
      </p>
      <p className="g-muted g-small">
        {mode === 'oos'
          ? 'Each dot is one past shock day. The model was fitted only on earlier data, so this is an honest test. Dots near the diagonal are good guesses.'
          : 'Each dot is one past day after a sharp US chip-stock fall. The model was fitted on data that includes these days, so this flatters it; the out-of-sample test is in ⑤ How accurate is it?'}
      </p>
    </figure>
  );
}

/** "Validated blend of 2 models (…) · the original single model said −11.1%" */
function ModelLine({ bundle, r }: { bundle: DataBundle; r: IndiaResult }) {
  const model = bundle.models?.find((m) => m.ticker === r.ticker) ?? null;
  const used = Object.entries(model?.components ?? {})
    .filter(([, c]) => isNum(c?.weight) && c.weight > 0)
    .sort((a, b) => b[1].weight - a[1].weight)
    .map(([id]) => bundle.backtest?.models.find((m) => m.id === id)?.label ?? id);
  if (r.model_used === 'ensemble' && used.length)
    return (
      <p className="g-model-line">
        <Icon name="layers" size={14} /> <Term id="ensemble">Validated blend</Term> of {used.length} {used.length === 1 ? 'model' : 'models'} ({used.join(', ')})
        {isNum(r.market_move_ols) && <> · the original single model said {pct(r.market_move_ols)}</>}
      </p>
    );
  if (r.model_used === 'ols')
    return (
      <p className="g-model-line">
        <Icon name="layers" size={14} /> Single 3-year regression — no validated blend for this company yet
      </p>
    );
  return null;
}

function Sure({
  bundle,
  r,
  text,
  accuracy,
}: {
  bundle: DataBundle;
  r: IndiaResult;
  text: string;
  accuracy: { text: string; r2_oos: number | null } | null;
}) {
  const c = r.confidence;
  const hasLab = !!bundle.models?.length;
  const tested = !!accuracy && isNum(accuracy.r2_oos);
  const since = bundle.securities[r.ticker]?.first_date ?? null;
  const zones = [
    { to: 40, color: 'var(--g-down)' },
    { to: 70, color: 'var(--g-accent)' },
    { to: 100, color: 'var(--g-up)' },
  ];
  return (
    <section className="g-card" aria-labelledby="sure">
      <h2 id="sure" className="g-h2">
        <Icon name="shield" size={20} /> How sure are we? <HelpChip id="confidence" />
      </h2>
      <div className="g-sure">
        <div className="g-sure-gauge">
          <Gauge value={c.score} min={0} max={100} zones={zones} label={`Confidence ${c.score} out of 100`} />
          <p className="g-sure-score">
            {c.score}
            <small>/100</small>
          </p>
          <ConfidenceDots grade={c.grade} />
        </div>
        <div className="g-sure-text">
          <p>{text}</p>
          <ul className="g-sure-factors">
            <li>
              <span>
                Fit to past prices <HelpChip id="r2" />
              </span>
              <Meter x={isNum(c.r2) ? Math.max(0, c.r2) / 0.4 : 0} label="fit to past prices" />
              <b>{isNum(c.r2) ? `R² ${c.r2.toFixed(2)}` : 'no fit'}</b>
            </li>
            <li>
              <span>
                Inputs that are assumptions <HelpChip id="user_assumption" />
              </span>
              <Meter x={c.assumption_share} label="share of assumed inputs" />
              <b>{pctAbs(c.assumption_share)}</b>
            </li>
            <li>
              <span>Price history used</span>
              <Meter x={Math.min(1, Math.sqrt(Math.max(0, c.n) / 250))} label="length of price history (full marks from about a year)" />
              <b>{c.n.toLocaleString('en-IN')} days</b>
            </li>
          </ul>
          {tested ? (
            <p className="g-sure-acc">
              <Icon name="target" size={16} /> {accuracy!.text}
            </p>
          ) : (
            <div className="g-sure-acc is-new">
              <span className="g-badge g-badge-new">
                <Icon name="clock" size={13} /> {hasLab ? 'Too new to test against history' : 'Not yet tested on unseen days'}
              </span>
              <p>
                {hasLab
                  ? `${r.display} has prices only since ${since ?? 'recently'}, so there are no past days the model had not already seen to check it against.`
                  : 'This data file has no out-of-sample test yet; treat the estimate as a rough guide.'}
              </p>
            </div>
          )}
          <ModelLine bundle={bundle} r={r} />
        </div>
      </div>
      {(tested || !hasLab) && <ShockDays bundle={bundle} r={r} />}
    </section>
  );
}

const EXPOSURE_LABEL: Record<string, string> = {
  revenue: 'Revenue from US tech clients',
  capex: 'Business tied to AI / data-centre orders',
  credit: 'Business with debt-heavy AI clouds',
};

function Facts({ bundle, r, t, sec }: { bundle: DataBundle; r: IndiaResult; t: IndiaTarget; sec: Security | undefined }) {
  const bench = sec?.bench ? bundle.securities[sec.bench]?.name ?? sec.bench : 'its benchmark';
  const parent = t.parent ? bundle.securities[t.parent]?.name ?? t.parent : null;
  const fx = t.fx_margin_sens_bps;
  return (
    <section className="g-card" aria-labelledby="facts">
      <h2 id="facts" className="g-h2">
        <Icon name="book" size={20} /> Key facts and where they come from
      </h2>
      <dl className="g-facts">
        {isNum(r.mcap_inr_cr) && (
          <div>
            <dt>
              <Term id="mcap">Market value</Term>
            </dt>
            <dd>
              {rupeesCr(r.mcap_inr_cr)} <GBadge status="COMPUTED" />
            </dd>
          </div>
        )}
        {sec && isNum(sec.pe_ttm) && (
          <div>
            <dt>
              <Term id="pe">Price-to-earnings</Term>
            </dt>
            <dd>
              {sec.pe_ttm.toFixed(1)}× now
              {isNum(sec.pe_pre_chatgpt_median) ? ` · ${sec.pe_pre_chatgpt_median.toFixed(1)}× before ChatGPT` : ' · no pre-ChatGPT history'} <GBadge status="COMPUTED" />
            </dd>
          </div>
        )}
        <div>
          <dt>
            <Term id="ai_premium">AI premium</Term>
          </dt>
          <dd>
            {!isNum(r.ai_premium)
              ? 'unknown — no AI premium is assumed'
              : sec && !isNum(sec.pe_pre_chatgpt_median)
                ? `about ${pct(r.ai_premium, 0)} — its group’s typical premium (no price-to-earnings history from before ChatGPT)`
                : `${pct(r.ai_premium, 0)} vs its pre-ChatGPT P/E`}{' '}
            <GBadge status={r.ai_premium_status} />
          </dd>
        </div>
        {isNum(r.ret_since_chatgpt_vs_bench) && (
          <div>
            <dt>Since ChatGPT launched, vs {bench}</dt>
            <dd>
              {pct(r.ret_since_chatgpt_vs_bench, 0)} <GBadge status="COMPUTED" />
            </dd>
          </div>
        )}
        {parent && (
          <div>
            <dt>
              <Term id="parent_link">Parent company</Term>
            </dt>
            <dd>
              {parent}
              {isNum(t.parent_stake?.value) ? ` owns ${pctAbs(t.parent_stake!.value)}` : ''} {t.parent_stake && <GBadge status={t.parent_stake.status} />}
              <Sources ids={t.parent_stake?.src} bundle={bundle} />
            </dd>
          </div>
        )}
        {t.exposures.map((e) => (
          <div key={e.channel}>
            <dt>{EXPOSURE_LABEL[e.channel] ?? e.channel}</dt>
            <dd>
              {isNum(e.share.value) ? pctAbs(e.share.value, e.share.value < 0.1 ? 1 : 0) : '—'} <GBadge status={e.share.status} />
              <Sources ids={e.share.src} bundle={bundle} />
            </dd>
          </div>
        ))}
        {isNum(fx?.value) && fx.value !== 0 && (
          <div>
            <dt>
              <Term id="fx_offset">Effect of a weaker rupee</Term>
            </dt>
            <dd>
              {fx.value > 0 ? '+' : '−'}
              {Math.abs(fx.value).toFixed(0)} <Term id="bps">bps</Term> of profit margin per 1% <GBadge status={fx.status} />
              <Sources ids={fx.src} bundle={bundle} />
            </dd>
          </div>
        )}
        {isNum(r.beta_total) && (
          <div>
            <dt>
              <Term id="beta_total">Follows US chip stocks</Term>
            </dt>
            <dd>
              about {Math.abs(r.beta_total * 10).toFixed(1)}% {r.beta_total >= 0 ? 'same way' : 'opposite way'} per 10% move <GBadge status="COMPUTED" />
            </dd>
          </div>
        )}
      </dl>
      {r.notes.length > 0 && (
        <details className="g-notes">
          <summary>Model notes for this company ({r.notes.length})</summary>
          <ul>
            {r.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PriceChart({ sec }: { sec: Security | undefined }) {
  const ph = sec?.price_history;
  const option = useMemo(() => {
    if (!ph || !ph.dates.length) return null;
    const inRange = ph.dates[0] <= CHATGPT && ph.dates[ph.dates.length - 1] >= CHATGPT;
    const cur = sec?.currency === 'INR' ? '₹' : sec?.currency === 'USD' ? '$' : '';
    return {
      backgroundColor: 'transparent',
      grid: { left: 56, right: 14, top: 22, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: GC.card2,
        borderColor: GC.line,
        textStyle: { color: GC.text, fontFamily: GC.mono, fontSize: 12 },
        valueFormatter: (v: number) => `${cur}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: GC.line } },
        axisLabel: { color: GC.muted, fontFamily: GC.mono, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: GC.muted, fontFamily: GC.mono, fontSize: 11, formatter: (v: number) => `${cur}${v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v.toFixed(0)}` },
        splitLine: { lineStyle: { color: GC.grid } },
      },
      series: [
        {
          type: 'line',
          name: 'Weekly close',
          data: ph.dates.map((d, i) => [d, ph.close[i]]),
          showSymbol: false,
          lineStyle: { width: 2, color: GC.accent },
          itemStyle: { color: GC.accent },
          areaStyle: { color: 'rgba(255,176,0,0.10)' },
          markLine: inRange
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: GC.muted, type: 'solid', width: 1 },
                label: { formatter: 'ChatGPT launch', color: GC.text, fontFamily: GC.sans, fontSize: 11, position: 'insideEndTop' },
                data: [{ xAxis: CHATGPT }],
              }
            : undefined,
        },
      ],
    };
  }, [ph, sec?.currency]);
  return (
    <section className="g-card" aria-labelledby="price">
      <h2 id="price" className="g-h2">
        <Icon name="trendUp" size={20} /> Its share price since 2021
      </h2>
      {option ? (
        <>
          <Chart option={option} height={260} themed={false} />
          <p className="g-muted g-small">
            Weekly closing price{sec?.currency ? ` in ${sec.currency}` : ''}.{' '}
            {ph && ph.dates[0] > CHATGPT
              ? `Its price data starts on ${sec?.first_date ?? ph.dates[0]}, after ChatGPT launched on 30 Nov 2022.`
              : 'The line marks ChatGPT’s launch on 30 Nov 2022.'}
          </p>
        </>
      ) : (
        <EmptyState title="No price history in the data bundle" />
      )}
    </section>
  );
}

export default function StockView({ state, actions }: GuidedProps) {
  const { bundle, result } = state;
  const ticker = state.selected;
  const r = result.india.find((x) => x.ticker === ticker) ?? null;
  const t = bundle.india.find((x) => x.ticker === ticker) ?? null;
  const exp = useMemo(() => (r ? getExplanation(bundle, result, r.ticker) : null), [bundle, result, r]);
  const order = useMemo(() => sortCompanies(result.india, 'fall').map((x) => x.ticker), [result]);

  if (!r || !t)
    return (
      <EmptyState icon="building" title="We couldn’t find that company">
        <p className="g-muted">It may not be one of the {bundle.india.length} Indian companies this model covers.</p>
        <button type="button" className="g-btn" onClick={() => actions.setView('impact')}>
          See all companies
        </button>
      </EmptyState>
    );

  const sec = bundle.securities[r.ticker];
  const mParts = marketParts(r);
  const bParts = businessParts(r);
  const engineText = new Map((exp?.reasons ?? []).map((x) => [x.channel, x.text]));
  const textFor = (ch: PartChannel) => {
    const e = engineText.get(ch as never);
    if (e && !(ch === 'fx' && r.fx_eps < 0)) return e;
    return reasonText(ch, r, bundle, result);
  };
  const idx = order.indexOf(r.ticker);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const nameOf = (tk: string) => result.india.find((x) => x.ticker === tk)?.display ?? tk;
  const marketNet = mParts.reduce((a, p) => a + (p.inr_cr ?? 0), 0);
  const tv = TIER_VIS[r.tier];

  return (
    <div className="g-stock">
      <nav className="g-crumbs" aria-label="Company navigation">
        <button type="button" className="g-link" onClick={() => actions.setView('impact')}>
          ← All companies
        </button>
        <span className="g-grow" />
        {prev && (
          <button type="button" className="g-link" onClick={() => actions.setView('stock', prev)} aria-label={`Previous company: ${nameOf(prev)}`}>
            ‹ {nameOf(prev)}
          </button>
        )}
        {next && (
          <button type="button" className="g-link" onClick={() => actions.setView('stock', next)} aria-label={`Next company: ${nameOf(next)}`}>
            {nameOf(next)} ›
          </button>
        )}
      </nav>

      <header className="g-stock-head">
        <span className="g-stock-ic" style={{ color: tv.color }}>
          <Icon name={tv.icon} size={28} />
        </span>
        <div>
          <h1 className="g-h1 is-page" tabIndex={-1} data-autofocus>
            {r.name} <span className="g-co-sym">{r.display}</span>
          </h1>
          <p className="g-stock-tier">
            <TierBadge tier={r.tier} /> <span className="g-muted">{tv.blurb}</span>
          </p>
        </div>
      </header>

      {exp && <p className="g-stock-headline">{exp.headline}</p>}

      <div className="g-stock-grid">
        <div className="g-stock-main">
          <Hero r={r} horizon={result.params.horizon} />

          <section className="g-card" aria-labelledby="why">
            <h2 id="why" className="g-h2">
              <Icon name="pulse" size={20} /> What moves the share price <HelpChip id="market_implied" />
            </h2>
            {mParts.length ? (
              <>
                <p className="g-muted">
                  How this share has reacted on similar days, split by <Term id="channel">channel</Term>. These add up to the headline move.
                </p>
                <DivergingStack parts={mParts} label="Price move split by channel" />
                <div className="g-dstack-scale" aria-hidden="true">
                  <span>← pushes the price down</span>
                  <span>holds it up →</span>
                </div>
                <PartRows parts={mParts} text={textFor} />
                <p className="g-net">
                  Altogether: <b>{pct(r.market_move)}</b>
                  {mParts.some((p) => p.inr_cr !== null) && <> ≈ {rupeesCr(marketNet, { sign: true })}</>}
                </p>
              </>
            ) : (
              <p className="g-muted">Nothing moves this share’s price in this scenario.</p>
            )}
          </section>

          <section className="g-card" aria-labelledby="biz">
            <h2 id="biz" className="g-h2">
              <Icon name="factory" size={20} /> What hurts the business <HelpChip id="fundamental" />
            </h2>
            {bParts.length ? (
              <>
                <p className="g-muted">
                  Damage to <Term id="eps">earnings</Term> and valuation — lost orders, a fading <Term id="ai_premium">AI premium</Term>, the rupee —
                  as a share of today’s price. A separate estimate from the price move above, compared with it below.
                </p>
                <DivergingStack parts={bParts} label="Business damage split by channel" />
                <div className="g-dstack-scale" aria-hidden="true">
                  <span>← lowers fair value</span>
                  <span>raises it →</span>
                </div>
                <PartRows parts={bParts} text={textFor} />
                <p className="g-net">
                  Altogether: <b>{pct(r.fundamental_net)}</b>
                </p>
              </>
            ) : r.fundamental_net === null ? (
              <Callout tone="info" title="Not modelled for this scenario">
                <p>A replay copies past price moves only; the business damage behind them is not modelled.</p>
              </Callout>
            ) : (
              <p className="g-muted">The business numbers barely change in this scenario.</p>
            )}
          </section>

          <PriceVsBusiness r={r} />
        </div>

        <div className="g-stock-side">
          <Sure bundle={bundle} r={r} text={exp?.confidence.text ?? ''} accuracy={exp?.accuracy ?? null} />
          <Facts bundle={bundle} r={r} t={t} sec={sec} />
          <PriceChart sec={sec} />
        </div>
      </div>

      <nav className="g-next" aria-label="Next steps">
        <button type="button" className="g-btn" onClick={() => actions.setView('flow')}>
          <Icon name="flow" size={16} /> See how the shock spreads
        </button>
        <button
          type="button"
          className="g-btn g-btn-ghost"
          onClick={() => {
            actions.select(r.ticker);
            actions.setMode('terminal');
          }}
        >
          <Icon name="terminal" size={16} /> Open in the terminal
        </button>
      </nav>
    </div>
  );
}
