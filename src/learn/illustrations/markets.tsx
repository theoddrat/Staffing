// "Markets & units" illustrations: index sparklines, market value, crore, basis points.
import { isNum } from '../../lib/format';
import { displayOf, fmtCrore, fmtNum, pctWord, target } from '../data';
import { Box, C, H, IconAt, type IllProps, linePath, scale, SchematicTag, Svg, Txt, W } from './kit';

const INDEX_NAME: Record<string, { name: string; what: string }> = {
  '^SOX': { name: 'PHLX Semiconductor index (SOX)', what: 'big US-listed chip companies' },
  '^NDX': { name: 'Nasdaq-100', what: 'the 100 largest non-financial Nasdaq stocks' },
  '^NSEI': { name: 'Nifty 50', what: '50 large Indian companies on the NSE' },
  '^CNXIT': { name: 'Nifty IT', what: 'large Indian IT-services companies' },
};

/** Weekly closes of an index since 2021, with the ChatGPT launch marked. */
export function IndexIll({ bundle, variant, compact }: IllProps) {
  const t = variant ?? '^SOX';
  const meta = INDEX_NAME[t] ?? { name: t, what: 'a basket of stocks' };
  const s = bundle?.securities?.[t];
  const ph = s?.price_history;
  const L = 8;
  const R = W - 8;
  const T = 40;
  const B = H - 26;
  if (!ph || ph.close.length < 10) {
    return (
      <Svg label={`${meta.name}: one number that tracks ${meta.what}`}>
        <Txt x={8} y={16} size={11} weight={600}>
          {meta.name}
        </Txt>
        <path d="M10,120 L60,100 L110,110 L160,70 L210,80 L260,40 L310,60" style={{ fill: 'none', stroke: C.accent, strokeWidth: 2 }} />
        <SchematicTag />
      </Svg>
    );
  }
  const vals = ph.close.filter(isNum);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const sx = scale(0, ph.close.length - 1, L, R);
  const sy = scale(lo, hi, B, T);
  const pts = ph.close.map((v, i) => (isNum(v) ? ([sx(i), sy(v)] as [number, number]) : null)).filter(Boolean) as [number, number][];
  const area = `${linePath(pts)} L${pts[pts.length - 1][0].toFixed(1)},${B} L${pts[0][0].toFixed(1)},${B} Z`;
  const gi = ph.dates.findIndex((d) => d >= '2022-11-30');
  const first = vals[0];
  const last = vals[vals.length - 1];
  const yr = (d: string) => d.slice(0, 4);
  return (
    <Svg label={`${meta.name}, weekly closes since ${yr(ph.dates[0])}`}>
      <Txt x={8} y={15} size={11} weight={600}>
        {meta.name}
      </Txt>
      {!compact && (
        <Txt x={8} y={29} size={9.5} color={C.muted}>
          {`one number tracking ${meta.what}`}
        </Txt>
      )}
      <path d={area} style={{ fill: C.accentSoft }} />
      <path d={linePath(pts)} style={{ fill: 'none', stroke: C.accent, strokeWidth: 1.6 }} />
      {gi > 0 && (
        <g>
          <line x1={sx(gi)} y1={T - 2} x2={sx(gi)} y2={B} style={{ stroke: C.muted, strokeDasharray: '3 3' }} />
          <Txt x={sx(gi) + 3} y={B - 4} size={8.5} color={C.muted}>
            ChatGPT launch
          </Txt>
        </g>
      )}
      <Txt x={L} y={H - 12} size={9} color={C.faint} mono>
        {yr(ph.dates[0])}
      </Txt>
      <Txt x={R} y={H - 12} size={9} color={C.faint} mono anchor="end">
        {ph.dates[ph.dates.length - 1]}
      </Txt>
      <Txt x={R} y={T - 4} size={10} anchor="end" mono weight={600}>
        {fmtNum(last, 0)}
      </Txt>
      <Txt x={W / 2} y={H - 12} size={9} anchor="middle" color={last >= first ? C.up : C.down} mono>
        {`${pctWord(last / first - 1, 0)} since ${yr(ph.dates[0])}`}
      </Txt>
    </Svg>
  );
}

/** Price × number of shares = market value, with a real Indian company. */
export function McapIll({ bundle, ticker }: IllProps) {
  const pick = [ticker, 'NETWEB.NS', 'INFY.NS'].find((t) => {
    const s = t ? bundle?.securities?.[t] : null;
    return !!s && isNum(s.last_close) && isNum(s.shares) && isNum(s.mcap_inr);
  });
  const s = pick ? bundle!.securities[pick] : null;
  const name = pick ? displayOf(bundle, pick) : 'A company';
  const grid = Array.from({ length: 24 }, (_, i) => i);
  return (
    <Svg label="Market value (market cap) = share price × number of shares">
      <Box x={8} y={34} w={70} h={56} color={C.accent} fill={C.accentSoft}>
        <IconAt name="tag" x={33} y={42} size={20} color={C.accent} />
        <Txt x={43} y={80} size={10} anchor="middle" mono weight={600}>
          {s ? `₹${fmtNum(s.last_close, 0)}` : 'price'}
        </Txt>
      </Box>
      <Txt x={43} y={106} size={9} anchor="middle" color={C.muted}>
        one share
      </Txt>
      <Txt x={92} y={68} size={16} anchor="middle" color={C.muted}>
        ×
      </Txt>
      {grid.map((i) => (
        <rect key={i} x={106 + (i % 6) * 13} y={38 + Math.floor(i / 6) * 13} width={10} height={10} rx={2} style={{ fill: C.card2, stroke: C.muted }} />
      ))}
      <Txt x={144} y={106} size={9} anchor="middle" color={C.muted}>
        {s ? `${fmtNum((s.shares as number) / 1e7, 2)} crore shares` : 'all its shares'}
      </Txt>
      <Txt x={198} y={68} size={16} anchor="middle" color={C.muted}>
        =
      </Txt>
      <Box x={212} y={24} w={100} h={76} color={C.up} fill={C.upSoft}>
        <IconAt name="building" x={250} y={32} size={24} color={C.up} />
        <Txt x={262} y={80} size={10.5} anchor="middle" mono weight={600}>
          {s ? fmtCrore((s.mcap_inr as number) / 1e7).replace(' crore', ' cr') : 'market value'}
        </Txt>
      </Box>
      <Txt x={262} y={116} size={9} anchor="middle" color={C.muted}>
        what the market values it at
      </Txt>
      <Txt x={8} y={16} size={11} weight={600}>
        {`${name}: market value`}
      </Txt>
      <Txt x={8} y={H - 8} size={9} color={C.faint}>
        {s ? `latest close ${s.last_date ?? ''}; grid of shares not to scale` : 'schematic'}
      </Txt>
    </Svg>
  );
}

/** Indian number units: lakh, crore, lakh crore, with dollar equivalents at today's rate. */
export function CroreIll({ bundle, result }: IllProps) {
  const fx = bundle?.meta?.usd_inr ?? null;
  const usdOf = (inr: number) => {
    if (!isNum(fx)) return '';
    const d = inr / (fx as number);
    if (d >= 1e9) return `≈ $${fmtNum(d / 1e9, 1)} billion`;
    if (d >= 1e5) return `≈ $${fmtNum(d / 1e3, 0)} thousand`;
    return `≈ $${fmtNum(d, 0)}`;
  };
  const rows = [
    { t: '1 lakh', n: '1,00,000', v: 1e5, cells: 1 },
    { t: '1 crore', n: '1,00,00,000 (= 100 lakh)', v: 1e7, cells: 10 },
    { t: '1 lakh crore', n: '₹1 trillion', v: 1e12, cells: 30 },
  ];
  const tot = result?.totals?.india_mcap_change_inr_cr;
  return (
    <Svg label="Indian units: 1 lakh = 100,000; 1 crore = 10 million; 1 lakh crore = 1 trillion rupees">
      {rows.map((r, i) => {
        const y = 14 + i * 40;
        const dollars = usdOf(r.v);
        return (
          <g key={r.t}>
            <Txt x={8} y={y + 12} size={11} weight={600} color={C.accent}>
              {`₹${r.t}`}
            </Txt>
            <Txt x={8} y={y + 26} size={9.5} color={C.muted} mono>
              {r.n}
            </Txt>
            {Array.from({ length: r.cells }, (_, j) => (
              <rect key={j} x={150 + (j % 15) * 9} y={y + 2 + Math.floor(j / 15) * 9} width={7} height={7} rx={1.5} style={{ fill: C.accent, opacity: 0.25 + 0.75 * (i / 2) }} />
            ))}
            <Txt x={W - 6} y={y + 26} size={9} color={C.faint} anchor="end">
              {dollars}
            </Txt>
          </g>
        );
      })}
      {isNum(tot) && (
        <Txt x={8} y={H - 8} size={9.5} color={C.text}>
          {`Scenario on screen: ${fmtCrore(tot)}`}
        </Txt>
      )}
      {!isNum(tot) && <SchematicTag />}
    </Svg>
  );
}

/** 100 basis points = 1%; a sourced margin sensitivity lights up its share of the grid. */
export function BpsIll({ bundle }: IllProps) {
  const t = bundle?.india.find((x) => x.fx_margin_sens_bps?.status === 'SOURCED' && isNum(x.fx_margin_sens_bps.value)) ?? null;
  const v = t ? Math.round(t.fx_margin_sens_bps.value as number) : 30;
  const lit = Math.max(0, Math.min(100, v));
  return (
    <Svg label="A basis point is one hundredth of a percent: 100 basis points make 1%">
      {Array.from({ length: 100 }, (_, i) => (
        <rect
          key={i}
          x={10 + (i % 10) * 13}
          y={14 + Math.floor(i / 10) * 13}
          width={11}
          height={11}
          rx={2}
          style={{ fill: i < lit ? 'var(--ch-fx)' : C.card2, stroke: i < lit ? 'none' : C.line }}
        />
      ))}
      <Txt x={148} y={30} size={11} weight={600}>
        100 squares = 1%
      </Txt>
      <Txt x={148} y={46} size={10} color={C.muted}>
        one square = 1 basis point
      </Txt>
      <Txt x={148} y={60} size={10} color={C.muted}>
        (bp, 0.01%)
      </Txt>
      <rect x={148} y={78} width={11} height={11} rx={2} style={{ fill: 'var(--ch-fx)' }} />
      <Txt x={164} y={87} size={10}>
        {`${lit} bps = ${fmtNum(lit / 100, 2)}%`}
      </Txt>
      {t && (
        <>
          <Txt x={148} y={110} size={9.5} color={C.text}>
            {`${displayOf(bundle, t.ticker)}: profit margin ≈ +${lit} bps`}
          </Txt>
          <Txt x={148} y={124} size={9.5} color={C.text}>
            for each 1% the rupee weakens
          </Txt>
          <Txt x={148} y={140} size={9} color={C.faint}>
            {target(bundle, t.ticker) ? 'sourced estimate (operating margin)' : ''}
          </Txt>
        </>
      )}
      {!t && <SchematicTag />}
    </Svg>
  );
}
