// "Uncertainty & accuracy" illustrations: Monte Carlo fan, range whisker, confidence gauge, R²,
// walk-forward (out-of-sample) testing, backtest scatter, ensemble, calibration and nowcast.
import { CONFIDENCE_VIS } from '../../guided/visual';
import type { BacktestEvent } from '../../types/data';
import { isNum } from '../../lib/format';
import { displayOf, extremeBy, fmtNum, pctWord, resultFor, simple, target } from '../data';
import { Arrow, C, H, IconAt, type IllProps, linePath, scale, SchematicTag, seeded, Svg, Txt, W } from './kit';

function normal(rnd: () => number) {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** Many simulated paths and the percentile fan they form (schematic paths, real range if run). */
export function McFanIll({ result, ticker, compact }: IllProps) {
  const rnd = seeded(42);
  const N = 60;
  const S = 40;
  const paths: number[][] = [];
  for (let i = 0; i < N; i++) {
    const p = [0];
    for (let s = 1; s <= S; s++) p.push(p[s - 1] - 0.004 + 0.022 * normal(rnd));
    paths.push(p);
  }
  const bands = Array.from({ length: S + 1 }, (_, s) => {
    const col = paths.map((p) => p[s]).sort((a, b) => a - b);
    return { p5: q(col, 0.05), p25: q(col, 0.25), p50: q(col, 0.5), p75: q(col, 0.75), p95: q(col, 0.95) };
  });
  const all = bands.flatMap((b) => [b.p5, b.p95]);
  const sx = scale(0, S, 14, W - 88);
  const sy = scale(Math.min(...all), Math.max(...all), H - 34, 26);
  const band = (a: 'p5' | 'p25', b: 'p95' | 'p75') =>
    `${linePath(bands.map((x, s) => [sx(s), sy(x[b])]))} ${linePath(bands.map((x, s): [number, number] => [sx(s), sy(x[a])]).reverse()).replace('M', 'L')} Z`;
  const r = (ticker ? resultFor(result, ticker) : null) ?? result?.india.find((x) => x.range) ?? null;
  const end = bands[S];
  return (
    <Svg label="Monte Carlo: thousands of what-ifs with slightly different luck form a fan of possible outcomes">
      <Txt x={8} y={14} size={10.5} weight={600}>
        Thousands of what-ifs, each with different luck
      </Txt>
      {paths.slice(0, compact ? 14 : 24).map((p, i) => (
        <path key={i} d={linePath(p.map((v, s) => [sx(s), sy(v)]))} style={{ fill: 'none', stroke: C.faint, strokeWidth: 0.7, opacity: 0.6 }} />
      ))}
      <path d={band('p5', 'p95')} style={{ fill: C.accent, opacity: 0.14 }} />
      <path d={band('p25', 'p75')} style={{ fill: C.accent, opacity: 0.22 }} />
      <path d={linePath(bands.map((x, s) => [sx(s), sy(x.p50)]))} style={{ fill: 'none', stroke: C.accent, strokeWidth: 2 }} />
      <Txt x={sx(S) + 6} y={sy(end.p95) + 3} size={9} color={C.muted}>
        good case (95%)
      </Txt>
      <Txt x={sx(S) + 6} y={sy(end.p50) + 3} size={9} color={C.accent}>
        middle
      </Txt>
      <Txt x={sx(S) + 6} y={sy(end.p5) + 3} size={9} color={C.muted}>
        bad case (5%)
      </Txt>
      <Txt x={14} y={H - 20} size={9} color={C.faint}>
        today → end of horizon
      </Txt>
      <Txt x={8} y={H - 6} size={9.5} color={r?.range ? C.text : C.faint}>
        {r?.range ? `${r.display}: ${pctWord(r.range.p5, 0)} to ${pctWord(r.range.p95, 0)} (5–95%)` : 'paths drawn for illustration; run the simulation for real ranges'}
      </Txt>
    </Svg>
  );
}

/** Low / middle / high on one line. */
export function RangeIll({ result, ticker }: IllProps) {
  const r = (ticker ? resultFor(result, ticker) : null) ?? extremeBy(result, (x) => (x.range ? x.range.p50 : null), 'min');
  const rg = r?.range ?? null;
  const p5 = rg ? rg.p5 : -0.32;
  const p50 = rg ? rg.p50 : -0.1;
  const p95 = rg ? rg.p95 : 0.14;
  const lo = Math.min(p5, -0.05) * 1.1;
  const hi = Math.max(p95, 0.05) * 1.1;
  const sx = scale(lo, hi, 20, W - 20);
  const y = 82;
  return (
    <Svg label="A range: the bad case, the middle and the good case from the simulation">
      <Txt x={8} y={16} size={11} weight={600}>
        {rg && r ? `${r.display}: the likely range` : 'Low, middle and high'}
      </Txt>
      <line x1={sx(0)} y1={40} x2={sx(0)} y2={120} style={{ stroke: C.line, strokeDasharray: '3 3' }} />
      <Txt x={sx(0)} y={132} size={9} anchor="middle" color={C.faint}>
        no change
      </Txt>
      <line x1={sx(p5)} y1={y} x2={sx(p95)} y2={y} style={{ stroke: C.accent, strokeWidth: 3, strokeLinecap: 'round' }} />
      <line x1={sx(p5)} y1={y - 9} x2={sx(p5)} y2={y + 9} style={{ stroke: C.down, strokeWidth: 2 }} />
      <line x1={sx(p95)} y1={y - 9} x2={sx(p95)} y2={y + 9} style={{ stroke: C.up, strokeWidth: 2 }} />
      <circle cx={sx(p50)} cy={y} r={7} style={{ fill: C.accent, stroke: C.card, strokeWidth: 2 }} />
      <Txt x={sx(p5)} y={y - 16} size={10} anchor="middle" mono color={C.down}>
        {pctWord(p5, 0)}
      </Txt>
      <Txt x={sx(p50)} y={y + 24} size={10.5} anchor="middle" mono weight={600} color={C.accent}>
        {pctWord(p50, 0)}
      </Txt>
      <Txt x={sx(p95)} y={y - 16} size={10} anchor="middle" mono color={C.up}>
        {pctWord(p95, 0)}
      </Txt>
      <Txt x={sx(p5)} y={y - 28} size={9} anchor="middle" color={C.muted}>
        bad case
      </Txt>
      <Txt x={sx(p95)} y={y - 28} size={9} anchor="middle" color={C.muted}>
        good case
      </Txt>
      <Txt x={8} y={H - 8} size={9.5} color={C.muted}>
        {rg ? '9 in 10 simulated outcomes fall between the ends' : 'example values — run the simulation to fill this in'}
      </Txt>
      {!rg && <SchematicTag x={W - 6} y={14} />}
    </Svg>
  );
}

/** A three-zone gauge with the needle at a stock's confidence score, plus the grade counts. */
export function ConfidenceIll({ result, ticker }: IllProps) {
  const r = (ticker ? resultFor(result, ticker) : null) ?? result?.india[0] ?? null;
  const cx = 110;
  const cy = 118;
  const rad = 78;
  const pt = (v: number, rr = rad) => {
    const a = Math.PI * (1 - v / 100);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number, color: string) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return <path d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${rad},${rad} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`} style={{ fill: 'none', stroke: color, strokeWidth: 14, opacity: 0.85 }} />;
  };
  const score = r?.confidence?.score;
  const counts = { HIGH: 0, MED: 0, LOW: 0 };
  for (const x of result?.india ?? []) counts[x.confidence.grade] += 1;
  const [nx, ny] = pt(isNum(score) ? Math.max(0, Math.min(100, score as number)) : 50, rad - 18);
  return (
    <Svg label="Confidence: how much to trust a stock's numbers, from past fit, data length and how much rests on assumptions">
      {arc(0, 39.5, CONFIDENCE_VIS.LOW.color)}
      {arc(40.5, 69.5, CONFIDENCE_VIS.MED.color)}
      {arc(70.5, 100, CONFIDENCE_VIS.HIGH.color)}
      <line x1={cx} y1={cy} x2={nx} y2={ny} style={{ stroke: C.text, strokeWidth: 2.4, strokeLinecap: 'round' }} />
      <circle cx={cx} cy={cy} r={5} style={{ fill: C.text }} />
      <Txt x={cx - rad} y={cy + 16} size={9} anchor="middle" color={C.muted}>
        0
      </Txt>
      <Txt x={cx + rad} y={cy + 16} size={9} anchor="middle" color={C.muted}>
        100
      </Txt>
      <Txt x={cx} y={cy + 34} size={10} anchor="middle" weight={600}>
        {r ? `${r.display}: ${fmtNum(score, 0)} — ${CONFIDENCE_VIS[r.confidence.grade].label}` : 'score out of 100'}
      </Txt>
      {(['HIGH', 'MED', 'LOW'] as const).map((g, i) => (
        <g key={g}>
          <circle cx={214} cy={42 + i * 26} r={6} style={{ fill: CONFIDENCE_VIS[g].color }} />
          <Txt x={226} y={46 + i * 26} size={9.5}>
            {CONFIDENCE_VIS[g].label}
          </Txt>
          {result && (
            <Txt x={W - 6} y={46 + i * 26} size={9.5} anchor="end" mono color={C.muted}>
              {counts[g]}
            </Txt>
          )}
        </g>
      ))}
      {result && (
        <Txt x={W - 6} y={22} size={8.5} anchor="end" color={C.faint}>
          stocks in this scenario
        </Txt>
      )}
    </Svg>
  );
}

/** Tight fit vs loose fit, then the real R² of one stock's model. */
export function R2Ill({ bundle, ticker }: IllProps) {
  const t = (ticker ? target(bundle, ticker) : null) ?? target(bundle, 'NETWEB.NS') ?? bundle?.india[0] ?? null;
  const r2s = (bundle?.india ?? []).map((x) => x.reg?.r2).filter(isNum).sort((a, b) => a - b);
  const med = r2s.length ? r2s[Math.floor(r2s.length / 2)] : null;
  const panel = (x0: number, slope: number, noise: number, seed: number, label: string) => {
    const rnd = seeded(seed);
    const sx = scale(-1, 1, x0 + 6, x0 + 136);
    const sy = scale(-1.2, 1.2, 116, 30);
    return (
      <g>
        <rect x={x0} y={24} width={142} height={98} rx={6} style={{ fill: C.card2, stroke: C.line }} />
        {Array.from({ length: 26 }, (_, i) => {
          const x = -0.95 + (i / 25) * 1.9;
          const y = Math.max(-1.15, Math.min(1.15, slope * x + noise * normal(rnd)));
          return <circle key={i} cx={sx(x)} cy={sy(y)} r={2.4} style={{ fill: C.accent, opacity: 0.75 }} />;
        })}
        <line x1={sx(-1)} y1={sy(-slope)} x2={sx(1)} y2={sy(slope)} style={{ stroke: C.text, strokeWidth: 1.5 }} />
        <Txt x={x0 + 71} y={136} size={9.5} anchor="middle">
          {label}
        </Txt>
      </g>
    );
  };
  return (
    <Svg label="R squared: the share of a stock's day-to-day moves that the model's line explains">
      {panel(8, 0.9, 0.12, 3, 'R² ≈ 0.9: dots hug the line')}
      {panel(170, 0.3, 0.5, 5, 'R² ≈ 0.1: mostly noise')}
      <Txt x={8} y={14} size={9} color={C.faint}>
        illustrative dots
      </Txt>
      <Txt x={8} y={H - 8} size={9.5} color={C.text}>
        {t?.reg && isNum(t.reg.r2) ? `${t.display}: R² ${fmtNum(t.reg.r2, 2)}${isNum(med) ? ` · median stock ${fmtNum(med, 2)}` : ''} (in-sample)` : 'real values appear once data is loaded'}
      </Txt>
    </Svg>
  );
}

/** Walk-forward testing: train on the past, score on the next stretch it has never seen, slide. */
export function OosIll({ bundle }: IllProps) {
  const bt = bundle?.backtest;
  const trainY = bt?.train_years ?? 3;
  const every = bt?.refit_every ?? 21;
  const sx = scale(0, 10, 12, W - 12);
  const rows = [0, 1, 2, 3];
  return (
    <Svg label="Out-of-sample testing: the model learns from the past, then is scored on later days it has never seen">
      <Txt x={8} y={14} size={10.5} weight={600}>
        Learn from the past, get scored on the unseen next stretch
      </Txt>
      {rows.map((k) => {
        const y = 26 + k * 24;
        const a = k * 0.9;
        return (
          <g key={k}>
            <rect x={sx(a)} y={y} width={sx(a + 6) - sx(a)} height={16} rx={3} style={{ fill: 'var(--ch-parent)', opacity: 0.35 }} />
            <rect x={sx(a + 6)} y={y} width={sx(a + 6.9) - sx(a + 6)} height={16} rx={3} style={{ fill: C.accent }} />
            {k === 0 && (
              <>
                <Txt x={sx(a + 3)} y={y + 11.5} size={9} anchor="middle">
                  {`learn: ${trainY} years`}
                </Txt>
                <Txt x={sx(a + 6.45)} y={y - 3} size={8.5} anchor="middle" color={C.accent}>
                  {`test: next ${every}`}
                </Txt>
              </>
            )}
          </g>
        );
      })}
      <Arrow x1={sx(0)} y1={128} x2={sx(9.5)} y2={128} color={C.muted} />
      <Txt x={sx(0)} y={142} size={9} color={C.muted}>
        time → (slide forward, refit, repeat)
      </Txt>
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        {bt ? `tested ${bt.start} → ${bt.end}` : 'no peeking: test days are never used for learning'}
      </Txt>
    </Svg>
  );
}

/** Pick the most informative past event (most stocks, DeepSeek preferred). */
export function showcaseEvent(events: BacktestEvent[] | undefined): BacktestEvent | null {
  if (!events?.length) return null;
  const ds = events.find((e) => /deepseek/i.test(e.id) && e.rows.length >= 5);
  if (ds) return ds;
  return [...events].sort((a, b) => b.rows.length - a.rows.length)[0] ?? null;
}

/** Predicted vs actual on a real past shock (or a labelled schematic). */
export function BacktestIll({ bundle }: IllProps) {
  const ev = showcaseEvent(bundle?.backtest?.events);
  const rows = (ev?.rows ?? []).filter((r) => isNum(r.actual) && isNum(r.pred.ensemble));
  const L = 34;
  const R = W - 10;
  const T = 22;
  const B = H - 30;
  if (!ev || rows.length < 3) {
    const rnd = seeded(9);
    const pts = Array.from({ length: 18 }, () => {
      const p = -0.02 - 0.08 * rnd();
      return { p, a: p + 0.03 * normal(rnd) };
    });
    const sx = scale(-0.12, 0.02, L, R);
    const sy = scale(-0.14, 0.03, B, T);
    return (
      <Svg label="A backtest: stand at a past date, predict, then compare with what really happened">
        <line x1={sx(-0.12)} y1={sy(-0.12)} x2={sx(0.02)} y2={sy(0.02)} style={{ stroke: C.muted, strokeDasharray: '4 3' }} />
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p.p)} cy={sy(p.a)} r={3} style={{ fill: C.accent, opacity: 0.75 }} />
        ))}
        <Txt x={8} y={14} size={10.5} weight={600}>
          Predicted (→) vs what really happened (↑)
        </Txt>
        <Txt x={sx(-0.03)} y={sy(-0.03) - 8} size={9} color={C.muted}>
          perfect line
        </Txt>
        <Txt x={8} y={H - 8} size={9} color={C.faint}>
          each dot: one stock on one past shock day
        </Txt>
        <SchematicTag x={W - 6} y={H - 20} />
      </Svg>
    );
  }
  const vals = rows.flatMap((r) => [r.actual, r.pred.ensemble as number]);
  const lo = Math.min(...vals, -0.01) - 0.01;
  const hi = Math.max(...vals, 0.01) + 0.01;
  const sx = scale(lo, hi, L, R);
  const sy = scale(lo, hi, B, T);
  const m = ev.metrics.ensemble;
  return (
    <Svg label={`Backtest on ${ev.label}: each stock's predicted next-session move against what really happened`}>
      <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} style={{ stroke: C.muted, strokeDasharray: '4 3' }} />
      <line x1={sx(0)} y1={T} x2={sx(0)} y2={B} style={{ stroke: C.line }} />
      <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} style={{ stroke: C.line }} />
      {rows.map((r) => (
        <circle key={r.ticker} cx={sx(r.pred.ensemble as number)} cy={sy(r.actual)} r={3} style={{ fill: C.accent, opacity: 0.8 }}>
          <title>{`${r.display}: predicted ${pctWord(simple(r.pred.ensemble as number))}, actual ${pctWord(simple(r.actual))}`}</title>
        </circle>
      ))}
      <Txt x={8} y={14} size={10.5} weight={600}>
        {`${ev.label}: predicted vs actual`}
      </Txt>
      <Txt x={R} y={H - 18} size={9} anchor="end" color={C.muted}>
        predicted before the day →
      </Txt>
      <Txt x={8} y={H - 6} size={9.5} color={C.text}>
        {m && isNum(m.corr) ? `ranking match (correlation) ${fmtNum(m.corr, 2)} · ${rows.length} stocks` : `${rows.length} stocks`}
      </Txt>
    </Svg>
  );
}

const DEFAULT_MODELS = [
  { id: 'ols', label: '3-year regression' },
  { id: 'dimson', label: 'allows a delayed reaction' },
  { id: 'shrink', label: 'shrunk toward its peers' },
  { id: 'ewma', label: 'recent days count more' },
  { id: 'asym', label: 'different on down days' },
  { id: 'huber', label: 'ignores freak days' },
];

/** Several models blended with weights learned from their past accuracy. */
export function EnsembleIll({ bundle }: IllProps) {
  const bt = bundle?.backtest;
  const w = bt?.ensemble?.weights ?? null;
  const label = (id: string) => bt?.models.find((m) => m.id === id)?.label ?? DEFAULT_MODELS.find((m) => m.id === id)?.label ?? id;
  const rows = w
    ? Object.entries(w)
        .filter(([, v]) => isNum(v) && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id, v]) => ({ id, label: label(id), v }))
    : DEFAULT_MODELS.map((m) => ({ id: m.id, label: m.label, v: null as number | null }));
  const rowH = Math.min(20, 120 / Math.max(rows.length, 1));
  return (
    <Svg label="An ensemble blends several models, giving more weight to the ones that predicted better out of sample">
      <Txt x={8} y={14} size={10.5} weight={600}>
        Several models, blended by past accuracy
      </Txt>
      {rows.map((r, i) => {
        const y = 24 + i * rowH;
        const bw = r.v !== null ? Math.max(2, r.v * 90) : 40;
        return (
          <g key={r.id}>
            <Txt x={8} y={y + rowH * 0.62} size={9}>
              {r.label}
            </Txt>
            <rect x={138} y={y + 3} width={bw} height={rowH - 7} rx={2} style={{ fill: 'var(--ch-revenue)', opacity: r.v !== null ? 0.9 : 0.35 }} />
            {r.v !== null && (
              <Txt x={142 + bw} y={y + rowH * 0.62} size={8.5} mono color={C.muted}>
                {`${Math.round(r.v * 100)}%`}
              </Txt>
            )}
            <Arrow x1={232} y1={y + rowH / 2} x2={262} y2={84} color={C.faint} width={0.8} head={3} />
          </g>
        );
      })}
      <circle cx={282} cy={84} r={18} style={{ fill: C.accentSoft, stroke: C.accent, strokeWidth: 1.5 }} />
      <IconAt name="layers" x={273} y={75} size={18} color={C.accent} />
      <Txt x={282} y={116} size={9.5} anchor="middle" color={C.accent} weight={600}>
        blend
      </Txt>
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        {w ? 'weights learned only from earlier out-of-sample errors' : 'weights appear once the accuracy lab has run'}
      </Txt>
    </Svg>
  );
}

/** "A 90% range should catch about 9 in 10 outcomes", with the real coverage when available. */
export function CalibrationIll({ bundle }: IllProps) {
  const cal = (bundle?.backtest?.calibration ?? []).filter((c) => isNum(c.nominal) && isNum(c.coverage));
  const rnd = seeded(21);
  const dots = Array.from({ length: 10 }, (_, i) => (i === 6 ? 1.35 : (rnd() - 0.5) * 1.5));
  const sy = scale(-1.5, 1.5, 104, 30);
  return (
    <Svg label="Calibration: a range that claims 90% should contain about 9 out of 10 real outcomes">
      <Txt x={8} y={14} size={10.5} weight={600}>
        A 90% range should catch 9 in 10
      </Txt>
      <rect x={10} y={sy(1)} width={150} height={sy(-1) - sy(1)} rx={6} style={{ fill: C.accent, opacity: 0.16, stroke: C.accent }} />
      {dots.map((d, i) => (
        <circle key={i} cx={22 + i * 14.5} cy={sy(d)} r={4} style={{ fill: Math.abs(d) <= 1 ? C.up : C.down }} />
      ))}
      <Txt x={85} y={124} size={9.5} anchor="middle" color={C.muted}>
        9 inside, 1 outside: well calibrated
      </Txt>
      {cal.length ? (
        cal.slice(0, 3).map((c, i) => {
          const y = 32 + i * 32;
          return (
            <g key={c.nominal}>
              <Txt x={176} y={y} size={9} color={C.muted}>
                {`${Math.round(c.nominal * 100)}% range caught`}
              </Txt>
              <rect x={176} y={y + 4} width={120} height={9} rx={2} style={{ fill: C.card2, stroke: C.line }} />
              <rect x={176} y={y + 4} width={120 * Math.min(1, c.coverage)} height={9} rx={2} style={{ fill: Math.abs(c.coverage - c.nominal) <= 0.05 ? C.up : C.accent }} />
              <line x1={176 + 120 * c.nominal} y1={y + 1} x2={176 + 120 * c.nominal} y2={y + 16} style={{ stroke: C.text, strokeWidth: 1.4 }} />
              <Txt x={300} y={y + 12} size={9} mono>
                {`${Math.round(c.coverage * 100)}%`}
              </Txt>
            </g>
          );
        })
      ) : (
        <Txt x={176} y={60} size={9.5} color={C.faint}>
          real coverage appears once the accuracy lab has run
        </Txt>
      )}
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        {cal.length ? 'bars: share of real outcomes inside each range (white tick = target)' : 'illustrative dots'}
      </Txt>
    </Svg>
  );
}

/** The nowcast clock: signals seen before the NSE close, and the prediction they feed. */
export function NowcastIll({ bundle }: IllProps) {
  const nc = bundle?.nowcast;
  const sx = scale(18, 40, 12, W - 12); // hours IST: 18:00 day 0 → 16:00 day 1
  return (
    <Svg label="Nowcast: a next-session estimate built from signals seen before the Indian market closes">
      <Txt x={8} y={14} size={10.5} weight={600}>
        Signals seen before India's close
      </Txt>
      <rect x={sx(19)} y={30} width={sx(25.5) - sx(19)} height={22} rx={5} style={{ fill: 'var(--ch-parent)', opacity: 0.3 }} />
      <Txt x={sx(22.25)} y={45} size={9} anchor="middle">
        US session: India funds, ADRs, chips
      </Txt>
      <rect x={sx(29.5)} y={60} width={sx(36) - sx(29.5)} height={22} rx={5} style={{ fill: 'var(--ch-fpi)', opacity: 0.3 }} />
      <Txt x={sx(32.75)} y={75} size={9} anchor="middle">
        Asian chip markets
      </Txt>
      <rect x={sx(33.25)} y={90} width={sx(39.5) - sx(33.25)} height={22} rx={5} style={{ fill: C.accent, opacity: 0.85 }} />
      <Txt x={sx(36.4)} y={105} size={9} anchor="middle" color={C.card} weight={600}>
        NSE session
      </Txt>
      <line x1={12} y1={124} x2={W - 12} y2={124} style={{ stroke: C.line }} />
      {[18, 24, 30, 36].map((h) => (
        <Txt key={h} x={sx(h)} y={136} size={8.5} anchor="middle" color={C.faint} mono>
          {`${String(h % 24).padStart(2, '0')}:00`}
        </Txt>
      ))}
      <Txt x={8} y={H - 18} size={9.5} color={C.text}>
        {nc?.nifty && isNum(nc.nifty.pred) ? `For ${nc.for_india_date}: Nifty ${pctWord(simple(nc.nifty.pred))}` : 'A model check, not a trading signal:'}
      </Txt>
      <Txt x={8} y={H - 5} size={9} color={C.muted}>
        most of the move happens at the 09:15 open
      </Txt>
    </Svg>
  );
}

/** Names of the stocks shown in illustrations (for tests and labels). */
export function illStock(bundle: IllProps['bundle'], ticker: string): string {
  return displayOf(bundle, ticker);
}
