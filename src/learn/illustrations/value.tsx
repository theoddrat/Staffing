// "Prices & earnings" illustrations: P/E, EPS, AI premium, operating leverage, earnings at risk,
// market-implied vs fundamental and the gap between them.
import { CHANNEL_VIS } from '../../guided/visual';
import type { DataBundle } from '../../types/data';
import type { IndiaResult, ScenarioResult } from '../../types/engine';
import { isNum } from '../../lib/format';
import { displayOf, extremeBy, fmtCrore, fmtNum, pctWord, resultFor } from '../data';
import { Arrow, C, H, IconAt, type IllProps, scale, SchematicTag, Svg, Txt, W } from './kit';

function withPe(b: DataBundle | null, prefer: (string | undefined)[]) {
  for (const t of prefer) {
    const s = t ? b?.securities?.[t] : null;
    if (s && isNum(s.pe_ttm) && isNum(s.eps_ttm) && isNum(s.last_close) && (s.pe_ttm as number) > 0) return s;
  }
  return null;
}

const money = (ccy: string, v: number, d = 0) => `${ccy === 'INR' ? '₹' : ccy === 'USD' ? '$' : ''}${fmtNum(v, d)}`;

/** Price = P/E × EPS: the price drawn as a stack of one-year profit slices. */
export function PeIll({ bundle, ticker }: IllProps) {
  const s = withPe(bundle, [ticker, 'INFY.NS', 'NVDA']);
  if (!s) {
    return (
      <Svg label="P/E: how many years of today's profit you pay for one share">
        <SchematicTag />
      </Svg>
    );
  }
  const pe = s.pe_ttm as number;
  const eps = s.eps_ttm as number;
  const n = Math.min(60, pe);
  const full = Math.floor(n);
  const base = 150;
  const sliceH = Math.min(4, 118 / Math.max(n, 1));
  const name = displayOf(bundle, s.ticker);
  return (
    <Svg label={`${name}: price ${money(s.currency, s.last_close as number)} is about ${fmtNum(pe, 1)} times its yearly profit per share`}>
      <Txt x={8} y={16} size={11} weight={600}>
        {`${name}: what you pay for a year of profit`}
      </Txt>
      <rect x={30} y={base - sliceH} width={46} height={sliceH} rx={1} style={{ fill: C.up }} />
      <Txt x={53} y={base - sliceH - 8} size={10} anchor="middle" mono weight={600}>
        {money(s.currency, eps, 2)}
      </Txt>
      <Txt x={53} y={base + 13} size={9} anchor="middle" color={C.muted}>
        profit per share (EPS)
      </Txt>
      {Array.from({ length: full }, (_, i) => (
        <rect key={i} x={170} y={base - (i + 1) * sliceH} width={46} height={Math.max(0.6, sliceH - 0.8)} style={{ fill: C.up, opacity: 0.55 + 0.45 * (i % 2) }} />
      ))}
      {n > full && <rect x={170} y={base - n * sliceH} width={46} height={(n - full) * sliceH} style={{ fill: C.up, opacity: 0.4 }} />}
      <Txt x={193} y={base - n * sliceH - 8} size={10} anchor="middle" mono weight={600}>
        {money(s.currency, s.last_close as number)}
      </Txt>
      <Txt x={193} y={base + 13} size={9} anchor="middle" color={C.muted}>
        share price
      </Txt>
      <Txt x={226} y={base - (n * sliceH) / 2 - 4} size={13} weight={600} color={C.accent} mono>
        {`= ${fmtNum(pe, 1)} ×`}
      </Txt>
      <Txt x={226} y={base - (n * sliceH) / 2 + 10} size={9.5} color={C.muted}>
        P/E ratio
      </Txt>
      <Arrow x1={82} y1={base - sliceH / 2} x2={164} y2={base - sliceH / 2} color={C.faint} dashed head={5} />
    </Svg>
  );
}

/** EPS = the company's yearly profit split across all its shares. */
export function EpsIll({ bundle, ticker }: IllProps) {
  const s = withPe(bundle, [ticker, 'INFY.NS', 'NVDA']);
  const ok = s && isNum(s.shares);
  const name = s ? displayOf(bundle, s.ticker) : 'A company';
  const profit = ok ? (s!.eps_ttm as number) * (s!.shares as number) : null;
  const inr = s?.currency === 'INR';
  return (
    <Svg label="Earnings per share: a company's profit for the year divided by its number of shares">
      <Txt x={8} y={16} size={11} weight={600}>
        {`${name}: one year of profit, split into shares`}
      </Txt>
      <rect x={10} y={28} width={120} height={96} rx={8} style={{ fill: C.upSoft, stroke: C.up }} />
      {Array.from({ length: 48 }, (_, i) => (
        <rect key={i} x={16 + (i % 8) * 14} y={34 + Math.floor(i / 8) * 14.5} width={11} height={11} rx={2} style={{ fill: C.up, opacity: i === 0 ? 1 : 0.35 }} />
      ))}
      <Txt x={70} y={140} size={9.5} anchor="middle" color={C.muted}>
        {profit !== null ? (inr ? `profit ${fmtCrore(profit / 1e7)}` : `profit $${fmtNum(profit / 1e9, 1)}bn`) : 'yearly profit'}
      </Txt>
      <Arrow x1={136} y1={76} x2={180} y2={76} color={C.text} />
      <rect x={196} y={56} width={40} height={40} rx={6} style={{ fill: C.up }} />
      <Txt x={216} y={112} size={10} anchor="middle" mono weight={600}>
        {s ? money(s.currency, s.eps_ttm as number, 2) : 'EPS'}
      </Txt>
      <Txt x={216} y={126} size={9.5} anchor="middle" color={C.muted}>
        per share
      </Txt>
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        {ok ? `÷ ${inr ? `${fmtNum((s!.shares as number) / 1e7, 0)} crore` : `${fmtNum((s!.shares as number) / 1e9, 2)}bn`} shares · last 12 months` : 'schematic'}
      </Txt>
    </Svg>
  );
}

/** Today's P/E vs. its pre-ChatGPT median, for stocks with real premiums of both signs. */
export function PremiumIll({ bundle, ticker }: IllProps) {
  const rows = (bundle?.india ?? [])
    .map((t) => ({ t, s: bundle!.securities[t.ticker] }))
    .filter((x) => x.s && isNum(x.s.ai_premium) && isNum(x.s.pe_ttm) && isNum(x.s.pe_pre_chatgpt_median));
  if (!rows.length) {
    return (
      <Svg label="AI premium: how much higher a stock's P/E is today than before ChatGPT">
        <SchematicTag />
      </Svg>
    );
  }
  rows.sort((a, c) => (c.s.ai_premium as number) - (a.s.ai_premium as number));
  const focus = rows.find((x) => x.t.ticker === ticker);
  const mid = rows[Math.floor(rows.length / 2)];
  const pick = [rows[0], focus ?? rows[Math.min(2, rows.length - 1)], focus ? mid : null, rows[rows.length - 1]]
    .filter((x, i, a): x is (typeof rows)[number] => !!x && a.findIndex((y) => y?.t.ticker === x.t.ticker) === i)
    .slice(0, 3);
  const max = Math.max(...pick.map((x) => Math.max(x.s.pe_ttm as number, x.s.pe_pre_chatgpt_median as number)));
  const hs = scale(0, max, 0, 92);
  const base = 136;
  const win = bundle?.meta?.pre_chatgpt;
  return (
    <Svg label="AI premium: today's price-to-earnings ratio compared with its median in the three years before ChatGPT">
      <Txt x={8} y={14} size={10.5} weight={600}>
        P/E before ChatGPT vs today
      </Txt>
      {pick.map((x, i) => {
        const cx = 20 + i * 102;
        const pre = x.s.pe_pre_chatgpt_median as number;
        const now = x.s.pe_ttm as number;
        const prem = x.s.ai_premium as number;
        return (
          <g key={x.t.ticker}>
            <rect x={cx} y={base - hs(pre)} width={30} height={hs(pre)} rx={3} style={{ fill: C.card2, stroke: C.muted }} />
            <rect x={cx + 34} y={base - hs(now)} width={30} height={hs(now)} rx={3} style={{ fill: prem > 0 ? 'var(--ch-premium)' : C.faint, opacity: 0.9 }} />
            <Txt x={cx + 15} y={base - hs(pre) - 4} size={8.5} anchor="middle" mono color={C.muted}>
              {`${fmtNum(pre, 0)}×`}
            </Txt>
            <Txt x={cx + 49} y={base - hs(now) - 4} size={8.5} anchor="middle" mono>
              {`${fmtNum(now, 0)}×`}
            </Txt>
            <Txt x={cx + 32} y={base + 12} size={9.5} anchor="middle" weight={600}>
              {x.t.display}
            </Txt>
            <Txt x={cx + 32} y={base + 25} size={9.5} anchor="middle" mono color={prem > 0 ? 'var(--ch-premium)' : C.muted}>
              {prem > 0 ? `+${fmtNum(prem * 100, 0)}% premium` : `${fmtNum(prem * 100, 0)}% (none)`}
            </Txt>
          </g>
        );
      })}
      <Txt x={W - 6} y={14} size={8.5} anchor="end" color={C.faint}>
        {win ? `grey: median ${win.window_start.slice(0, 4)}–${win.window_end.slice(0, 4)}` : 'grey: before'}
      </Txt>
    </Svg>
  );
}

function pickBy(result: ScenarioResult | null, ticker: string | undefined, key: (r: IndiaResult) => number | null | undefined, dir: 'min' | 'max' = 'max') {
  return (ticker ? resultFor(result, ticker) : null) ?? extremeBy(result, key, dir);
}

/** Revenue falls 10% → operating profit falls 10% × operating leverage. */
export function OpLevIll({ bundle, ticker }: IllProps) {
  const cands = [ticker, 'STLTECH.NS', 'WIPRO.NS'].filter(Boolean) as string[];
  const s = cands.map((t) => bundle?.securities?.[t]).find((x) => x && isNum(x.op_leverage?.value) && (x.op_leverage.value as number) > 1.05) ?? null;
  const ol = s ? (s.op_leverage.value as number) : 1.5;
  const name = s ? displayOf(bundle, s.ticker) : 'Example';
  const rev = 0.1;
  const prof = Math.min(0.95, rev * ol);
  const base = 132;
  const h = 92;
  return (
    <Svg label="Operating leverage: because many costs are fixed, profit falls faster than sales">
      <Txt x={8} y={16} size={11} weight={600}>
        {`${name}: sales −10% → profit −${fmtNum(prof * 100, 0)}%`}
      </Txt>
      {[
        { x: 40, t: 'sales', cut: rev, color: 'var(--ch-revenue)' },
        { x: 190, t: 'operating profit', cut: prof, color: C.up },
      ].map((b) => (
        <g key={b.t}>
          <rect x={b.x} y={base - h} width={70} height={h} rx={4} style={{ fill: C.downSoft, stroke: C.down, strokeDasharray: '3 2' }} />
          <rect x={b.x} y={base - h * (1 - b.cut)} width={70} height={h * (1 - b.cut)} rx={4} style={{ fill: b.color, opacity: 0.85 }} />
          <Txt x={b.x + 35} y={base - h * (1 - b.cut / 2) + 4} size={10} anchor="middle" color={C.down} weight={600}>
            {`−${fmtNum(b.cut * 100, 0)}%`}
          </Txt>
          <Txt x={b.x + 35} y={base + 14} size={9.5} anchor="middle" color={C.muted}>
            {b.t}
          </Txt>
        </g>
      ))}
      <Arrow x1={116} y1={base - h / 2} x2={184} y2={base - h / 2} color={C.text} />
      <Txt x={150} y={base - h / 2 - 8} size={10} anchor="middle" mono weight={600} color={C.accent}>
        {`× ${fmtNum(ol, 2)}`}
      </Txt>
      <Txt x={8} y={H - 4} size={9} color={C.faint}>
        {s ? 'operating leverage from its last two annual reports (computed)' : 'default 1.5× — a user assumption'}
      </Txt>
    </Svg>
  );
}

/** Earnings at risk: the bite taken out of profit, coloured by channel. */
export function EarIll({ result, ticker }: IllProps) {
  const r = pickBy(result, ticker, (x) => x.ear, 'max');
  if (!r || !(r.ear > 0)) {
    return (
      <Svg label="Earnings at risk: the share of yearly profit this scenario could remove">
        <rect x={40} y={40} width={240} height={50} rx={6} style={{ fill: C.up, opacity: 0.8 }} />
        <rect x={220} y={40} width={60} height={50} rx={6} style={{ fill: C.downSoft, stroke: C.down, strokeDasharray: '3 2' }} />
        <Txt x={160} y={116} size={10} anchor="middle" color={C.muted}>
          the slice at risk = earnings at risk (EaR)
        </Txt>
        <SchematicTag />
      </Svg>
    );
  }
  const parts = (['revenue', 'capex', 'credit', 'own'] as const)
    .map((k) => ({ k, v: Math.max(0, r.ear_contrib[k] ?? 0) }))
    .filter((p) => p.v > 0);
  const tot = parts.reduce((s, p) => s + p.v, 0) || r.ear;
  const x0 = 20;
  const w = 280;
  const keep = w * (1 - r.ear);
  let x = x0 + keep;
  return (
    <Svg label={`${r.display}: about ${fmtNum(r.ear * 100, 0)}% of yearly profit at risk in this scenario`}>
      <Txt x={8} y={16} size={11} weight={600}>
        {`${r.display}: profit at risk in this scenario`}
      </Txt>
      <rect x={x0} y={36} width={keep} height={48} rx={6} style={{ fill: C.up, opacity: 0.8 }} />
      {parts.map((p) => {
        const pw = (w - keep) * (p.v / tot);
        const node = (
          <rect key={p.k} x={x} y={36} width={Math.max(1, pw)} height={48} style={{ fill: CHANNEL_VIS[p.k].color, opacity: 0.9 }} />
        );
        x += pw;
        return node;
      })}
      <Txt x={x0 + keep / 2} y={65} size={10} anchor="middle" color={C.card} weight={600}>
        profit that stays
      </Txt>
      <Txt x={x0 + w} y={100} size={12} anchor="end" color={C.down} weight={600} mono>
        {`−${fmtNum(r.ear * 100, 1)}%`}
      </Txt>
      {parts.map((p, i) => (
        <g key={p.k}>
          <rect x={20} y={112 + i * 14} width={9} height={9} rx={2} style={{ fill: CHANNEL_VIS[p.k].color }} />
          <Txt x={34} y={120 + i * 14} size={9.5}>
            {`${CHANNEL_VIS[p.k].label} (${fmtNum(p.v * 100, 1)}%)`}
          </Txt>
        </g>
      ))}
    </Svg>
  );
}

/** Two answers to "how far could it fall?" and the gap between them. */
export function MarketFundIll({ result, ticker, variant }: IllProps) {
  const r =
    (ticker ? resultFor(result, ticker) : null) ??
    extremeBy(result, (x) => (isNum(x.gap) && isNum(x.fundamental_net) ? Math.abs(x.gap as number) : null), 'max');
  const focus = variant === 'fundamental' || variant === 'gap' ? variant : 'market';
  const m = r?.market_move;
  const f = r?.fundamental_net;
  const ok = isNum(m) && isNum(f);
  const mv = ok ? (m as number) : -0.12;
  const fv = ok ? (f as number) : -0.05;
  const lo = Math.min(mv, fv, -0.02);
  const sh = scale(0, -lo, 0, 96);
  const top = 36;
  const bar = (x: number, v: number, color: string, on: boolean, label: string, sub: string) => (
    <g style={{ opacity: on ? 1 : 0.45 }}>
      <rect x={x} y={top} width={64} height={Math.max(1.5, sh(Math.max(0, -v)))} rx={4} style={{ fill: color }} />
      <Txt x={x + 32} y={top + sh(Math.max(0, -v)) + 14} size={10.5} anchor="middle" mono weight={600}>
        {pctWord(v)}
      </Txt>
      <Txt x={x + 32} y={top - 14} size={9.5} anchor="middle" weight={on ? 600 : 400}>
        {label}
      </Txt>
      <Txt x={x + 32} y={top - 3} size={8.5} anchor="middle" color={C.muted}>
        {sub}
      </Txt>
    </g>
  );
  const gapOn = focus === 'gap';
  return (
    <Svg label="Market-implied move (from past price co-movement) versus fundamental damage (from profits), and the gap between them">
      <line x1={10} y1={top} x2={W - 10} y2={top} style={{ stroke: C.line }} />
      {bar(30, mv, C.accent, focus === 'market' || gapOn, 'market-implied', 'how prices moved before')}
      {bar(170, fv, C.up, focus === 'fundamental' || gapOn, 'fundamental', 'damage to profits')}
      {ok && (
        <g style={{ opacity: gapOn ? 1 : 0.55 }}>
          <line x1={98} y1={top + sh(-mv)} x2={166} y2={top + sh(-mv)} style={{ stroke: C.down, strokeDasharray: '3 2' }} />
          <line x1={98} y1={top + sh(-fv)} x2={166} y2={top + sh(-fv)} style={{ stroke: C.down, strokeDasharray: '3 2' }} />
          <line x1={132} y1={top + sh(-mv)} x2={132} y2={top + sh(-fv)} style={{ stroke: C.down, strokeWidth: 2 }} />
          <Txt x={250} y={top + (sh(-mv) + sh(-fv)) / 2} size={10} color={C.down} weight={600}>
            {`gap ${pctWord(mv - fv)}`}
          </Txt>
        </g>
      )}
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        {ok && r ? `${r.display}, scenario on screen` : 'schematic'}
      </Txt>
      {gapOn && ok && (
        <Txt x={W - 6} y={H - 6} size={9} anchor="end" color={C.muted}>
          {mv < fv ? 'prices fall more than profits' : 'profits fall more than prices'}
        </Txt>
      )}
      {!ok && <IconAt name="help" x={290} y={130} size={16} color={C.faint} />}
    </Svg>
  );
}
