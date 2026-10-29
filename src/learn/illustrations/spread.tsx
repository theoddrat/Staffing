// "How it spreads" illustrations: beta, lag, channels, tiers, FPI, FX, overnight signals.
import { CHANNEL_VIS, TIER_VIS } from '../../guided/visual';
import type { Tier } from '../../types/data';
import type { Channel } from '../../types/engine';
import { isNum } from '../../lib/format';
import { betaShowcase, displayOf, fitLine, fmtCrore, fmtNum, pctWord, shockPoints, target, tierCounts } from '../data';
import { Arrow, Box, C, H, IconAt, type IllProps, linePath, scale, SchematicTag, seeded, Svg, Txt, W } from './kit';

/** Scatter of real "big US-chip day → Indian next-session move" points with a fitted line. */
export function BetaIll({ bundle, ticker, compact }: IllProps) {
  const t = ticker && shockPoints(bundle, ticker).length >= 5 ? ticker : betaShowcase(bundle, ticker);
  const pts = t ? shockPoints(bundle, t) : [];
  const L = 34;
  const R = W - 10;
  const T = 16;
  const B = H - 30;
  if (pts.length < 5) {
    const rnd = seeded(7);
    const fake = Array.from({ length: 16 }, (_, i) => {
      const x = -0.9 + (i / 15) * 1.1;
      return { x, y: 0.45 * x + (rnd() - 0.5) * 0.35 };
    });
    const sx = scale(-1, 0.3, L, R);
    const sy = scale(-0.8, 0.4, B, T);
    return (
      <Svg label="Beta: a stock that follows US chips falls with them, along a sloped line">
        <line x1={sx(0)} y1={T} x2={sx(0)} y2={B} style={{ stroke: C.line }} />
        <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} style={{ stroke: C.line }} />
        {fake.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3} style={{ fill: C.accent, opacity: 0.7 }} />
        ))}
        <line x1={sx(-1)} y1={sy(-0.45)} x2={sx(0.3)} y2={sy(0.135)} style={{ stroke: C.text, strokeWidth: 1.6 }} />
        <Txt x={L} y={H - 12} size={10} color={C.muted}>US chips move →</Txt>
        <Txt x={L} y={12} size={10} color={C.muted}>↑ Indian stock, next session</Txt>
        <SchematicTag />
      </Svg>
    );
  }
  const xs = pts.map((p) => p.x * 100);
  const ys = pts.map((p) => p.y * 100);
  const x0 = Math.min(...xs, 0) - 0.5;
  const x1 = Math.max(...xs, 0) + 0.5;
  const yAbs = Math.max(...ys.map(Math.abs), 1);
  const y0 = -Math.min(yAbs, 25) * 1.1;
  const y1 = Math.min(yAbs, 25) * 1.1;
  const sx = scale(x0, x1, L, R);
  const sy = scale(y0, y1, B, T);
  const fit = fitLine(pts.map((p) => ({ x: p.x * 100, y: p.y * 100 })));
  const tg = target(bundle, t!);
  const color = tg ? TIER_VIS[tg.tier].color : C.accent;
  const name = displayOf(bundle, t!);
  const clampY = (v: number) => Math.max(y0, Math.min(y1, v));
  const ticksX = [Math.ceil(x0), 0].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <Svg label={`How ${name} moved on big US-chip days`}>
      <line x1={sx(0)} y1={T} x2={sx(0)} y2={B} style={{ stroke: C.line }} />
      <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} style={{ stroke: C.line }} />
      {ticksX.map((v) => (
        <Txt key={v} x={sx(v)} y={B + 11} size={9} color={C.faint} anchor="middle" mono>
          {v}%
        </Txt>
      ))}
      <Txt x={L - 4} y={sy(y1 * 0.8) + 3} size={9} color={C.faint} anchor="end" mono>
        {`+${Math.round(y1 * 0.8)}%`}
      </Txt>
      <Txt x={L - 4} y={sy(y0 * 0.8) + 3} size={9} color={C.faint} anchor="end" mono>
        {`${Math.round(y0 * 0.8)}%`}
      </Txt>
      {pts.map((p, i) => (
        <circle key={i} cx={sx(p.x * 100)} cy={sy(clampY(p.y * 100))} r={2.8} style={{ fill: color, opacity: 0.72 }}>
          <title>{`${p.date}: US chips ${pctWord(Math.exp(p.x) - 1)} → ${name} ${pctWord(Math.exp(p.y) - 1)}`}</title>
        </circle>
      ))}
      {fit && (
        <path
          d={linePath([
            [sx(x0), sy(clampY(fit.a + fit.b * x0))],
            [sx(x1), sy(clampY(fit.a + fit.b * x1))],
          ])}
          style={{ stroke: C.text, strokeWidth: 1.8, fill: 'none' }}
        />
      )}
      <Txt x={L} y={11} size={10} color={C.muted}>{`↑ ${name}, next Indian session`}</Txt>
      <Txt x={R} y={H - 6} size={10} color={C.muted} anchor="end">US chip index (SOX) that night →</Txt>
      {fit && !compact && (
        <Txt x={R} y={T + 10} size={10} color={C.accent} anchor="end" weight={600}>
          {`slope ${fit.b.toFixed(2)} on ${fit.n} big US-chip days`}
        </Txt>
      )}
    </Svg>
  );
}

/** 36-hour clock: why a US move reaches India the next session (Tokyo the same day). */
export function LagIll({ compact }: IllProps) {
  const sx = scale(6, 42, 22, W - 8); // hours IST from 06:00 day 1 to 18:00 day 2
  const rows = [
    { y: 30, label: 'India (NSE)', color: C.accent },
    { y: 72, label: 'New York', color: 'var(--ch-parent)' },
    { y: 114, label: 'Tokyo', color: 'var(--ch-fpi)' },
  ];
  const bar = (y: number, a: number, b: number, color: string) => (
    <rect x={sx(a)} y={y - 8} width={sx(b) - sx(a)} height={16} rx={4} style={{ fill: color, opacity: 0.85 }} />
  );
  return (
    <Svg label="Time zones: New York closes after India, so US news hits India the next session; Tokyo closes before India">
      <line x1={sx(24)} y1={12} x2={sx(24)} y2={H - 22} style={{ stroke: C.line, strokeDasharray: '3 3' }} />
      <Txt x={sx(15)} y={10} size={9} color={C.faint} anchor="middle">Day 1</Txt>
      <Txt x={sx(33)} y={10} size={9} color={C.faint} anchor="middle">Day 2</Txt>
      {rows.map((r) => (
        <Txt key={r.label} x={4} y={r.y - 12} size={9.5} color={C.muted}>
          {r.label}
        </Txt>
      ))}
      {bar(30, 9.25, 15.5, C.accent)}
      {bar(30, 33.25, 39.5, C.accent)}
      {bar(72, 19, 25.5, 'var(--ch-parent)')}
      {bar(114, 29.5, 36, 'var(--ch-fpi)')}
      <Arrow x1={sx(25.5)} y1={66} x2={sx(33.4)} y2={40} color={C.text} />
      <Arrow x1={sx(36)} y1={108} x2={sx(36.4)} y2={40} color={C.text} dashed />
      {[6, 12, 18, 24, 30, 36, 42].map((h) => (
        <Txt key={h} x={sx(h)} y={H - 10} size={9} color={C.faint} anchor="middle" mono>
          {String(h % 24).padStart(2, '0')}:00
        </Txt>
      ))}
      {!compact && (
        <>
          <Txt x={sx(25.6)} y={88} size={9.5} color={C.text}>closes ~01:30 IST</Txt>
          <Txt x={sx(25.6)} y={99} size={8.5} color={C.faint}>(02:30 in Nov–Mar)</Txt>
          <Txt x={sx(36.6)} y={128} size={9.5} color={C.text}>closes 12:00 IST</Txt>
        </>
      )}
      <Txt x={W - 6} y={H - 24} size={8.5} color={C.faint} anchor="end">times in India Standard Time</Txt>
    </Svg>
  );
}

const FIVE: Channel[] = ['parent', 'revenue', 'capex', 'sentiment', 'fx_fpi'];
const SHORT: Record<string, string> = {
  parent: 'Parent company',
  revenue: 'IT budgets',
  capex: 'Data-centre orders',
  sentiment: 'Investor mood',
  fx_fpi: 'Foreign money',
};

/** Five pipes from the US shock to an Indian stock; widths from the live scenario when available. */
export function ChannelsIll({ result, focus, compact }: IllProps) {
  const totals: Record<string, number> = {};
  for (const r of result?.india ?? []) {
    for (const ch of FIVE) {
      const v = r.channel_inr_cr?.[ch];
      if (isNum(v)) totals[ch] = (totals[ch] ?? 0) + Math.abs(v);
    }
  }
  const max = Math.max(1, ...Object.values(totals));
  const ys = [26, 55, 84, 113, 142];
  const x0 = 78;
  const x1 = 242;
  return (
    <Svg label="Five channels carry a US AI shock to Indian stocks">
      <Box x={6} y={58} w={66} h={54} color={C.down} fill={C.downSoft}>
        <IconAt name="globe" x={30} y={66} size={18} color={C.down} />
        <Txt x={39} y={98} size={9.5} anchor="middle" color={C.text}>US AI shock</Txt>
      </Box>
      <Box x={248} y={58} w={66} h={54} color={C.accent} fill={C.accentSoft}>
        <IconAt name="trendDown" x={272} y={66} size={18} color={C.accent} />
        <Txt x={281} y={98} size={9.5} anchor="middle" color={C.text}>Indian stock</Txt>
      </Box>
      {FIVE.map((ch, i) => {
        const vis = CHANNEL_VIS[ch];
        const y = ys[i];
        const dim = focus && focus !== ch;
        const width = totals[ch] ? 2 + (totals[ch] / max) * 7 : 3;
        const d = `M${x0},85 C${x0 + 40},85 ${x0 + 30},${y} ${x0 + 70},${y} L${x1 - 70},${y} C${x1 - 30},${y} ${x1 - 40},85 ${x1},85`;
        return (
          <g key={ch} style={{ opacity: dim ? 0.22 : 1 }}>
            <path d={d} style={{ fill: 'none', stroke: vis.color, strokeWidth: width, strokeLinecap: 'round', opacity: 0.85 }} />
            <circle cx={160} cy={y} r={10} style={{ fill: C.card, stroke: vis.color, strokeWidth: 1.2 }} />
            <IconAt name={vis.icon} x={153} y={y - 7} size={14} color={vis.color} />
            {!compact && (
              <Txt x={174} y={y + 3.5} size={9} color={C.text}>
                {SHORT[ch]}
              </Txt>
            )}
            {!compact && totals[ch] ? (
              <Txt x={146} y={y + 3.5} size={8.5} color={C.muted} anchor="end" mono>
                {fmtCrore(-totals[ch]).replace(' crore', ' cr')}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </Svg>
  );
}

/** The four groups of Indian companies. */
export function TiersIll({ bundle }: IllProps) {
  const counts = tierCounts(bundle);
  const tiers: Tier[] = ['A', 'B', 'C', 'D'];
  return (
    <Svg label="Four groups of Indian companies by how they are linked to US AI">
      {tiers.map((t, i) => {
        const vis = TIER_VIS[t];
        const x = 8 + (i % 2) * 156;
        const y = 8 + Math.floor(i / 2) * 80;
        return (
          <Box key={t} x={x} y={y} w={148} h={72} color={vis.color} fill={C.card2}>
            <IconAt name={vis.icon} x={x + 10} y={y + 10} size={20} color={vis.color} />
            <Txt x={x + 38} y={y + 25} size={12} weight={600} color={vis.color}>{`Tier ${t}`}</Txt>
            {bundle && (
              <Txt x={x + 138} y={y + 25} size={10} anchor="end" color={C.muted} mono>
                {`${counts[t]} cos`}
              </Txt>
            )}
            {vis.label.split(' ').reduce<string[]>((lines, w) => {
              const last = lines[lines.length - 1];
              if (last !== undefined && (last + ' ' + w).length <= 24) lines[lines.length - 1] = last + ' ' + w;
              else lines.push(w);
              return lines;
            }, []).slice(0, 2).map((line, j) => (
              <Txt key={j} x={x + 10} y={y + 46 + j * 13} size={10} color={C.text}>
                {line}
              </Txt>
            ))}
          </Box>
        );
      })}
    </Svg>
  );
}

/** Foreign funds selling India in a global sell-off. */
export function FpiIll({ bundle, result, compact }: IllProps) {
  const nifty = result?.factors?.NIFTY;
  const f = result?.factors?.inr_depr ?? bundle?.fx?.default_f?.value ?? null;
  return (
    <Svg label="Foreign investors sell Indian shares in a global sell-off, pulling the Nifty and the rupee down">
      <Box x={196} y={30} w={116} h={96} color={C.accent} fill={C.accentSoft}>
        <Txt x={254} y={52} size={11} weight={600} anchor="middle">Indian shares</Txt>
        <IconAt name="trendDown" x={243} y={60} size={22} color={C.down} />
        <Txt x={254} y={104} size={10} anchor="middle" color={C.muted}>Nifty</Txt>
        {isNum(nifty) && (
          <Txt x={254} y={118} size={11} anchor="middle" color={nifty < 0 ? C.down : C.up} mono weight={600}>
            {pctWord(nifty)}
          </Txt>
        )}
      </Box>
      <Box x={8} y={44} w={86} h={68} color={'var(--ch-fpi)'} fill={C.card2}>
        <IconAt name="globe" x={40} y={52} size={22} color={'var(--ch-fpi)'} />
        <Txt x={51} y={94} size={10} anchor="middle">Global funds</Txt>
      </Box>
      {[60, 78, 96].map((y, i) => (
        <g key={y}>
          <Arrow x1={192} y1={y} x2={100} y2={y} color={'var(--ch-fpi)'} width={1.6 + i * 0.4} />
          <circle cx={146 - i * 8} cy={y} r={6} style={{ fill: C.card, stroke: C.accent, strokeWidth: 1 }} />
          <Txt x={146 - i * 8} y={y + 3.5} size={8} anchor="middle" color={C.accent} weight={600}>
            ₹
          </Txt>
        </g>
      ))}
      <Txt x={146} y={30} size={10} anchor="middle" color={C.text}>money flows out</Txt>
      {!compact && isNum(f) && (
        <Txt x={8} y={H - 10} size={9.5} color={C.muted}>
          {`rupee weakens ~${fmtNum((f as number) * 100, 1)}% in this view`}
        </Txt>
      )}
    </Svg>
  );
}

/** A weaker rupee: the same $100 of revenue is worth more rupees. */
export function FxIll({ bundle, result, compact }: IllProps) {
  const spot = bundle?.fx?.spot ?? bundle?.meta?.usd_inr ?? null;
  const f = result?.factors?.inr_depr ?? bundle?.fx?.default_f?.value ?? null;
  const before = isNum(spot) ? 100 * spot : null;
  const after = isNum(spot) && isNum(f) ? 100 * spot * (1 + (f as number)) : null;
  const max = Math.max(before ?? 1, after ?? 1);
  const sh = scale(0, max, 0, 104);
  const base = 140;
  return (
    <Svg label="A weaker rupee turns each dollar of export revenue into more rupees">
      <Txt x={10} y={18} size={11} weight={600}>$100 of IT export revenue, in rupees</Txt>
      {before !== null && (
        <>
          <rect x={60} y={base - sh(before)} width={70} height={sh(before)} rx={5} style={{ fill: C.card2, stroke: C.muted }} />
          <Txt x={95} y={base - sh(before) - 6} size={10.5} anchor="middle" mono>
            {`₹${Math.round(before).toLocaleString('en-IN')}`}
          </Txt>
          <Txt x={95} y={base + 14} size={10} anchor="middle" color={C.muted}>today</Txt>
        </>
      )}
      {after !== null && (
        <>
          <rect x={190} y={base - sh(after)} width={70} height={sh(after)} rx={5} style={{ fill: 'var(--ch-fx)', opacity: 0.85 }} />
          <Txt x={225} y={base - sh(after) - 6} size={10.5} anchor="middle" mono weight={600}>
            {`₹${Math.round(after).toLocaleString('en-IN')}`}
          </Txt>
          <Txt x={225} y={base + 14} size={10} anchor="middle" color={C.muted}>
            {`rupee ${fmtNum((f as number) * 100, 1)}% weaker`}
          </Txt>
          <Arrow x1={136} y1={base - sh(before ?? 0) / 2} x2={184} y2={base - sh(after) / 2} color={C.text} />
        </>
      )}
      {before === null && (
        <>
          <rect x={60} y={70} width={70} height={70} rx={5} style={{ fill: C.card2, stroke: C.muted }} />
          <rect x={190} y={55} width={70} height={85} rx={5} style={{ fill: 'var(--ch-fx)', opacity: 0.85 }} />
          <SchematicTag />
        </>
      )}
      {!compact && <Txt x={10} y={H - 4} size={9} color={C.faint}>exporters' costs are mostly in rupees, so profit rises</Txt>}
    </Svg>
  );
}

/** Overnight: India funds and Indian ADRs trade in New York while India is closed. */
export function OvernightIll({ compact }: IllProps) {
  const sx = scale(15, 34, 14, W - 14);
  const rnd = seeded(11);
  const ticks: [number, number][] = [];
  let y = 80;
  for (let h = 19; h <= 25.5; h += 0.25) {
    y += (rnd() - 0.55) * 7;
    ticks.push([sx(h), Math.max(50, Math.min(112, y))]);
  }
  return (
    <Svg label="While India sleeps, Indian ADRs and India funds trade in New York and hint at India's next open">
      <rect x={sx(15)} y={128} width={sx(15.5) - sx(15)} height={14} rx={3} style={{ fill: C.accent }} />
      <rect x={sx(33.25)} y={128} width={sx(34) - sx(33.25)} height={14} rx={3} style={{ fill: C.accent }} />
      <Txt x={sx(15)} y={156} size={9} color={C.muted}>India closes 15:30</Txt>
      <Txt x={sx(34)} y={156} size={9} color={C.muted} anchor="end">opens 09:15</Txt>
      <rect x={sx(19)} y={44} width={sx(25.5) - sx(19)} height={74} rx={6} style={{ fill: C.card2, stroke: 'var(--ch-parent)' }} />
      <path d={linePath(ticks)} style={{ fill: 'none', stroke: 'var(--ch-parent)', strokeWidth: 1.6 }} />
      <Txt x={sx(22.25)} y={36} size={10} anchor="middle" color={C.text}>New York session</Txt>
      {!compact && <Txt x={sx(22.25)} y={112} size={8.5} anchor="middle" color={C.muted}>India ETFs · ADRs · chips</Txt>}
      <Arrow x1={sx(25.6)} y1={80} x2={sx(33.1)} y2={130} color={C.text} />
      <Txt x={sx(29.5)} y={98} size={9.5} anchor="middle" color={C.text}>gap at the open</Txt>
      <Txt x={W - 6} y={14} size={8.5} color={C.faint} anchor="end">price path schematic</Txt>
    </Svg>
  );
}
