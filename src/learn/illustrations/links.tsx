// "How it spreads" (part 2): parent link, the total-beta waterfall, downside beta, past rupee episodes.
import { TIER_VIS } from '../../guided/visual';
import { isNum } from '../../lib/format';
import { betaShowcase, displayOf, fmtNum, nameOf, pctWord, shockPoints, short, simple, target } from '../data';
import { Arrow, Box, C, H, IconAt, type IllProps, scale, SchematicTag, Svg, Txt, W } from './kit';

/** Parent → Indian arm, with the real stake and the past parent sensitivity. */
export function ParentIll({ bundle, result, ticker }: IllProps) {
  const tierA = (bundle?.india ?? []).filter((t) => t.tier === 'A' && t.parent);
  const fromResult = result?.india.find((r) => r.tier === 'A' && r.dominant_channel === 'parent')?.ticker;
  const t =
    tierA.find((x) => x.ticker === ticker) ??
    tierA.find((x) => x.ticker === fromResult) ??
    tierA.find((x) => x.ticker === 'GVT&D.NS') ??
    tierA[0] ??
    null;
  const stake = t?.parent_stake?.value;
  const bP = t?.reg?.coef?.PARENT?.b;
  const parentName = t?.parent ? short(nameOf(bundle, t.parent).replace(/,? Inc\.?$| Corporation$| AG$| SE$| Ltd\.?$/i, ''), 16) : 'Global parent';
  const arm = t ? displayOf(bundle, t.ticker) : 'Indian arm';
  return (
    <Svg label="Parent link: an Indian company controlled by a global parent tends to move when the parent's shares move">
      <Box x={8} y={22} w={110} h={70} color={'var(--ch-parent)'} fill={C.card2}>
        <IconAt name="globe" x={18} y={32} size={20} color={'var(--ch-parent)'} />
        <Txt x={44} y={47} size={10.5} weight={600}>
          {parentName}
        </Txt>
        <Txt x={18} y={78} size={9.5} color={C.muted}>
          global parent
        </Txt>
      </Box>
      <Box x={202} y={22} w={110} h={70} color={TIER_VIS.A.color} fill={C.card2}>
        <IconAt name="building" x={212} y={32} size={20} color={TIER_VIS.A.color} />
        <Txt x={238} y={47} size={10.5} weight={600}>
          {arm}
        </Txt>
        <Txt x={212} y={78} size={9.5} color={C.muted}>
          listed in India
        </Txt>
      </Box>
      <Arrow x1={122} y1={50} x2={198} y2={50} color={'var(--ch-parent)'} width={2} />
      <Txt x={160} y={42} size={9.5} anchor="middle">
        {isNum(stake) ? `owns ${Math.round((stake as number) * 100)}%` : 'controls'}
      </Txt>
      <Arrow x1={198} y1={72} x2={122} y2={72} color={C.faint} width={1} dashed head={4} />
      <Txt x={160} y={86} size={8.5} anchor="middle" color={C.faint}>
        price moves follow
      </Txt>
      {isNum(bP) ? (
        <>
          <Txt x={8} y={118} size={10}>
            {`On top of the US-chip effect: when ${parentName}`}
          </Txt>
          <Txt x={8} y={132} size={10}>
            {`fell 10%, ${arm} has tended to move ${pctWord(simple((bP as number) * Math.log(0.9)))}`}
          </Txt>
          <Txt x={8} y={148} size={9} color={C.faint}>
            past 3 years of daily data; stake from company filings
          </Txt>
        </>
      ) : (
        <SchematicTag />
      )}
    </Svg>
  );
}

/** Where a stock's total AI beta comes from: direct + via Nasdaq + via parent + via Nifty. */
export function betaParts(bundle: IllProps['bundle'], ticker: string) {
  const t = target(bundle, ticker);
  const c = t?.reg?.coef;
  const nm = bundle?.nifty_model?.coef;
  if (!t || !c || !c.SOX || !nm) return null;
  const mN = t.slopes.ndx_on_sox ?? 0;
  const mP = t.slopes.parent_on_sox ?? 0;
  const parts = [
    { key: 'direct', label: 'direct link to US chips', v: c.SOX.b, color: 'var(--ch-sentiment)' },
    { key: 'ndx', label: 'via the Nasdaq-100', v: (c.NDX?.b ?? 0) * mN, color: 'var(--ch-revenue)' },
    { key: 'parent', label: 'via the parent company', v: (c.PARENT?.b ?? 0) * mP, color: 'var(--ch-parent)' },
    { key: 'nifty', label: 'via the Nifty (foreign money)', v: (c.NIFTY?.b ?? 0) * ((nm.SOX?.b ?? 0) + (nm.NDX?.b ?? 0) * mN), color: 'var(--ch-fpi)' },
  ].filter((p) => isNum(p.v) && (p.key !== 'parent' || !!t.parent));
  const total = parts.reduce((s, p) => s + p.v, 0);
  return { ticker: t.ticker, display: t.display, parts, total, reported: t.beta_total };
}

export function BetaTotalIll({ bundle, ticker }: IllProps) {
  const pick = ticker && betaParts(bundle, ticker) ? ticker : (betaShowcase(bundle) ?? 'NETWEB.NS');
  const bp = betaParts(bundle, pick);
  if (!bp) {
    return (
      <Svg label="Total beta adds up every path from US chip stocks to an Indian stock">
        <SchematicTag />
      </Svg>
    );
  }
  const vals: number[] = [0];
  let run = 0;
  for (const p of bp.parts) {
    run += p.v;
    vals.push(run);
  }
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0.05, ...vals);
  const sx = scale(lo, hi, 150, W - 40);
  const rowH = 22;
  let acc = 0;
  return (
    <Svg label={`${bp.display}: total beta ${fmtNum(bp.total, 2)}, built from each path`}>
      <Txt x={8} y={14} size={11} weight={600}>
        {`${bp.display}: adding up the paths`}
      </Txt>
      <line x1={sx(0)} y1={20} x2={sx(0)} y2={30 + (bp.parts.length + 1) * rowH} style={{ stroke: C.line }} />
      {bp.parts.map((p, i) => {
        const a = acc;
        acc += p.v;
        const y = 24 + i * rowH;
        const x0 = sx(Math.min(a, acc));
        const w = Math.max(1.5, Math.abs(sx(acc) - sx(a)));
        return (
          <g key={p.key}>
            <Txt x={8} y={y + 12} size={9.5}>
              {p.label}
            </Txt>
            <rect x={x0} y={y + 2} width={w} height={14} rx={2} style={{ fill: p.color, opacity: 0.85 }} />
            <Txt x={Math.max(sx(a), sx(acc)) + 4} y={y + 13} size={9} mono color={p.v < 0 ? C.down : C.text}>
              {`${p.v >= 0 ? '+' : '−'}${fmtNum(Math.abs(p.v), 2)}`}
            </Txt>
          </g>
        );
      })}
      {(() => {
        const y = 24 + bp.parts.length * rowH + 4;
        return (
          <g>
            <Txt x={8} y={y + 12} size={10} weight={600} color={C.accent}>
              = total beta
            </Txt>
            <rect x={sx(Math.min(0, bp.total))} y={y + 2} width={Math.max(1.5, Math.abs(sx(bp.total) - sx(0)))} height={14} rx={2} style={{ fill: C.accent }} />
            <Txt x={Math.max(sx(0), sx(bp.total)) + 4} y={y + 13} size={10} mono weight={600} color={C.accent}>
              {fmtNum(bp.total, 2)}
            </Txt>
          </g>
        );
      })()}
      <Txt x={8} y={H - 8} size={9.5} color={C.muted}>
        {`US chips −10% → ${bp.display} ≈ ${pctWord(simple(bp.total * Math.log(0.9)))} the next session`}
      </Txt>
    </Svg>
  );
}

/** Ordinary-day slope vs. worst-5%-day slope, over the stock's real shock-day dots. */
export function DownsideIll({ bundle, ticker }: IllProps) {
  const pick = ticker && target(bundle, ticker)?.beta_total_down != null ? ticker : (betaShowcase(bundle) ?? 'NETWEB.NS');
  const t = target(bundle, pick);
  const b = t?.beta_total;
  const bd = t?.beta_total_down;
  const pts = shockPoints(bundle, pick).filter((p) => p.x < 0);
  const L = 30;
  const R = W - 10;
  const T = 22;
  const B = H - 34;
  const sx = scale(-0.12, 0, L, R);
  const ymin = Math.min(-0.06, ...(isNum(bd) ? [(bd as number) * -0.12] : []), ...pts.map((p) => Math.max(-0.2, p.y)));
  const sy = scale(ymin * 1.05, 0.04, B, T);
  const line = (slope: number, color: string, dash?: string) => (
    <line x1={sx(-0.12)} y1={sy(slope * -0.12)} x2={sx(0)} y2={sy(0)} style={{ stroke: color, strokeWidth: 2, strokeDasharray: dash }} />
  );
  return (
    <Svg label="Downside beta: how strongly a stock follows US chips on the worst days, compared with ordinary days">
      <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} style={{ stroke: C.line }} />
      <line x1={sx(0)} y1={T} x2={sx(0)} y2={B} style={{ stroke: C.line }} />
      {pts.map((p, i) => (
        <circle key={i} cx={sx(Math.max(-0.12, p.x))} cy={sy(Math.max(ymin * 1.05, Math.min(0.04, p.y)))} r={2.4} style={{ fill: C.faint }} />
      ))}
      {isNum(b) && line(b as number, C.text, '5 3')}
      {isNum(bd) && line(bd as number, C.down)}
      <Txt x={8} y={14} size={10.5} weight={600}>
        {t ? `${t.display}: ordinary days vs the worst days` : 'Ordinary days vs the worst days'}
      </Txt>
      {isNum(b) && (
        <Txt x={R} y={B + 14} size={9.5} anchor="end" color={C.text}>
          {`- - all days: ${fmtNum(b, 2)}`}
        </Txt>
      )}
      {isNum(bd) && (
        <Txt x={R} y={B + 27} size={9.5} anchor="end" color={C.down} weight={600}>
          {`— worst 5% of US-chip days: ${fmtNum(bd, 2)}`}
        </Txt>
      )}
      <Txt x={L} y={B + 14} size={9} color={C.faint}>
        US chips that night →
      </Txt>
      {!isNum(b) && <SchematicTag />}
    </Svg>
  );
}

/** Real rupee moves in past US tech sell-offs, with the median used as the default. */
export function RupeeIll({ bundle, result }: IllProps) {
  const eps = (bundle?.fx?.episodes ?? []).filter((e) => isNum(e.inr_depr));
  const f = bundle?.fx?.default_f?.value;
  const cur = result?.factors?.inr_depr;
  if (!eps.length) {
    return (
      <Svg label="Rupee depreciation: the rupee buys fewer dollars">
        <SchematicTag />
      </Svg>
    );
  }
  const vals = eps.map((e) => Math.exp(e.inr_depr as number) - 1);
  const max = Math.max(0.05, ...vals.map(Math.abs));
  const zero = 110;
  const sw = scale(0, max, 0, 150);
  const rowH = Math.min(12, 128 / eps.length);
  return (
    <Svg label="How much the rupee weakened in past US tech sell-offs">
      <Txt x={8} y={13} size={10.5} weight={600}>
        Rupee in past US tech sell-offs
      </Txt>
      {eps.map((e, i) => {
        const v = vals[i];
        const y = 20 + i * rowH;
        return (
          <g key={e.id}>
            <Txt x={8} y={y + rowH * 0.75} size={8.5} color={C.muted}>
              {short(e.label, 19)}
            </Txt>
            <rect
              x={v >= 0 ? zero : zero - sw(-v)}
              y={y + 1.5}
              width={Math.max(1.2, sw(Math.abs(v)))}
              height={rowH - 3.5}
              rx={1.5}
              style={{ fill: v >= 0 ? 'var(--ch-fx)' : C.faint, opacity: 0.85 }}
            />
            <Txt x={zero + sw(Math.max(0, v)) + 4} y={y + rowH * 0.75} size={8.5} mono color={C.muted}>
              {pctWord(v, 1)}
            </Txt>
          </g>
        );
      })}
      <line x1={zero} y1={18} x2={zero} y2={22 + eps.length * rowH} style={{ stroke: C.line }} />
      <Txt x={8} y={H - 6} size={9} color={C.text}>
        {`${isNum(f) ? `median ${pctWord(Math.exp(f as number) - 1)} weaker` : ''}${isNum(cur) ? ` · scenario: ${pctWord(cur as number)}` : ''}`}
      </Txt>
    </Svg>
  );
}
