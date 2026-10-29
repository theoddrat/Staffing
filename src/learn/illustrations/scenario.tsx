// "The scenario" illustrations: the what-if presets, the horizon, the bubble and each shock type.
import { isNum } from '../../lib/format';
import { fmtCrore, fmtNum, hyperscalerCapex, isActive, paramValue, pctWord, short, simple } from '../data';
import { Arrow, Box, C, H, IconAt, type IllProps, linePath, scale, SchematicTag, Svg, Txt, W } from './kit';

const PRESET_TILES = [
  { id: 'fullpop', lines: ['Full bubble', 'pop'], icon: 'layers', color: C.down },
  { id: 'capex', lines: ['Big Tech cuts', 'AI spending'], icon: 'server', color: 'var(--ch-capex)' },
  { id: 'guidance', lines: ['A chipmaker', 'warns'], icon: 'chip', color: 'var(--ch-revenue)' },
  { id: 'restatement', lines: ['Accounting', 'scandal'], icon: 'warning', color: 'var(--ch-own)' },
  { id: 'multiple', lines: ['AI stocks', 'get cheaper'], icon: 'tag', color: 'var(--ch-premium)' },
  { id: 'credit', lines: ['AI borrowers', 'squeezed'], icon: 'bank', color: 'var(--ch-credit)' },
  { id: 'replay', lines: ['Replay a', 'past crash'], icon: 'clock', color: 'var(--ch-parent)' },
];

const COMPANY: Record<string, string> = {
  MSFT: 'Microsoft',
  GOOGL: 'Alphabet',
  AMZN: 'Amazon',
  META: 'Meta',
  ORCL: 'Oracle',
  CRWV: 'CoreWeave',
  NVDA: 'NVIDIA',
  SMCI: 'Super Micro',
};

const bn = (v: number) => `$${Math.round(v / 1e9).toLocaleString('en-US')}bn`;

/** The seven ready-made what-ifs; the one on screen is highlighted. */
export function ScenarioIll({ result }: IllProps) {
  const cur = result?.params.preset ?? null;
  return (
    <Svg label="A scenario is one hypothetical what-if, such as Big Tech cutting AI spending">
      <Txt x={8} y={16} size={11} weight={600}>
        Seven ready-made “what ifs”
      </Txt>
      {PRESET_TILES.map((p, i) => {
        const row = i < 4 ? 0 : 1;
        const col = row === 0 ? i : i - 4;
        const x = row === 0 ? 8 + col * 77 : 46 + col * 77;
        const y = 26 + row * 64;
        const on = cur === p.id;
        return (
          <g key={p.id}>
            <rect
              x={x}
              y={y}
              width={71}
              height={56}
              rx={8}
              style={{ fill: on ? C.accentSoft : C.card2, stroke: on ? C.accent : C.line, strokeWidth: on ? 1.6 : 1 }}
            />
            <IconAt name={p.icon} x={x + 8} y={y + 7} size={16} color={p.color} />
            <Txt x={x + 8} y={y + 37} size={9.5}>
              {p.lines[0]}
            </Txt>
            <Txt x={x + 8} y={y + 49} size={9.5}>
              {p.lines[1]}
            </Txt>
          </g>
        );
      })}
      <Txt x={8} y={H - 8} size={9.5} color={C.muted}>
        {cur ? 'Highlighted: the one on screen now. None is a forecast.' : 'Pick one, then follow it to Indian stocks.'}
      </Txt>
    </Svg>
  );
}

const HZ = [
  { id: '1D', label: '1 day', sub: 'next session', x: 44 },
  { id: '1M', label: '1 month', sub: '≈21 sessions', x: 162 },
  { id: '12M', label: '12 months', sub: '≈252 sessions', x: 278 },
];

/** Three horizons on one arrow; the current one is highlighted. */
export function HorizonIll({ result }: IllProps) {
  const cur = result?.params.horizon ?? null;
  return (
    <Svg label="The horizon is how far ahead the what-if looks: one day, one month or twelve months">
      <Txt x={8} y={16} size={11} weight={600}>
        How far ahead are we looking?
      </Txt>
      <Arrow x1={14} y1={80} x2={312} y2={80} color={C.muted} width={2} head={8} />
      <circle cx={14} cy={80} r={4.5} style={{ fill: C.text }} />
      <Txt x={10} y={102} size={9.5} color={C.muted}>
        now
      </Txt>
      {HZ.map((h) => {
        const on = cur === h.id;
        return (
          <g key={h.id}>
            <circle cx={h.x} cy={80} r={on ? 11 : 7} style={{ fill: on ? C.accent : C.card2, stroke: on ? C.accent : C.muted, strokeWidth: 1.5 }} />
            <Txt x={h.x} y={58} size={11} anchor="middle" weight={on ? 600 : 400} color={on ? C.accent : C.text}>
              {h.label}
            </Txt>
            <Txt x={h.x} y={108} size={9} anchor="middle" color={C.muted}>
              {h.sub}
            </Txt>
          </g>
        );
      })}
      <Txt x={8} y={140} size={9.5} color={C.muted}>
        Longer horizons give a shock more time to spread,
      </Txt>
      <Txt x={8} y={153} size={9.5} color={C.muted}>
        and the range of possible outcomes gets wider.
      </Txt>
    </Svg>
  );
}

/** Price racing ahead of profits, then deflating (schematic). */
export function BubbleIll({ compact }: IllProps) {
  const sx = scale(0, 10, 14, W - 12);
  const sy = scale(0, 9.5, 146, 22);
  const prof = (t: number) => 1.6 + 0.32 * t;
  const bub = (t: number) => 5.2 * Math.exp(-((t - 6.4) ** 2) / (2 * (t < 6.4 ? 1.9 : 0.75) ** 2));
  const ts = Array.from({ length: 101 }, (_, i) => i / 10);
  const pPrice = ts.map((t) => [sx(t), sy(prof(t) + bub(t))] as [number, number]);
  const pProf = ts.map((t) => [sx(t), sy(prof(t))] as [number, number]);
  const area = `${linePath(pPrice)} ${linePath([...pProf].reverse()).replace('M', 'L')} Z`;
  return (
    <Svg label="A bubble: share prices race ahead of the profits that justify them, then deflate">
      <path d={area} style={{ fill: C.accentSoft }} />
      <path d={linePath(pProf)} style={{ fill: 'none', stroke: C.up, strokeWidth: 1.8, strokeDasharray: '5 3' }} />
      <path d={linePath(pPrice)} style={{ fill: 'none', stroke: C.accent, strokeWidth: 2.2 }} />
      <Txt x={sx(6.4)} y={sy(prof(6.4) + bub(6.4)) - 7} size={10} anchor="middle" color={C.accent} weight={600}>
        share prices
      </Txt>
      <Txt x={sx(4.9)} y={sy(prof(4.9) + 1.45)} size={9.5} anchor="middle" color={C.text}>
        the bubble
      </Txt>
      <Txt x={W - 12} y={sy(prof(10)) + 14} size={9.5} anchor="end" color={C.up}>
        profits
      </Txt>
      <Arrow x1={sx(7.2)} y1={sy(6.6)} x2={sx(8.2)} y2={sy(4.4)} color={C.down} />
      {!compact && (
        <Txt x={sx(8.35)} y={sy(6.2)} size={9.5} color={C.down}>
          deflation
        </Txt>
      )}
      <Txt x={14} y={14} size={9} color={C.faint}>
        time →
      </Txt>
      <SchematicTag />
    </Svg>
  );
}

/** Real trailing-12-month capital spending of the hyperscalers. */
export function CapexIll({ bundle }: IllProps) {
  const cx = hyperscalerCapex(bundle);
  if (!cx) {
    return (
      <Svg label="Capex is money spent on buildings and equipment such as data centres">
        <IconAt name="cloud" x={30} y={50} size={40} color={'var(--ch-parent)'} />
        <Arrow x1={84} y1={70} x2={150} y2={70} color={C.text} />
        <IconAt name="server" x={164} y={50} size={40} color={'var(--ch-capex)'} />
        <Txt x={160} y={130} size={10} anchor="middle" color={C.muted}>
          spending on data centres, chips and power
        </Txt>
        <SchematicTag />
      </Svg>
    );
  }
  const max = cx.rows[0].value;
  const sw = scale(0, max, 0, 160);
  return (
    <Svg label={`Big Tech capital spending in the last four reported quarters: ${bn(cx.total)} in total`}>
      <Txt x={8} y={16} size={11} weight={600}>
        Capital spending, last 4 reported quarters
      </Txt>
      {cx.rows.slice(0, 5).map((r, i) => {
        const y = 30 + i * 22;
        return (
          <g key={r.ticker}>
            <Txt x={8} y={y + 11} size={10}>
              {COMPANY[r.ticker] ?? r.ticker}
            </Txt>
            <rect x={84} y={y} width={Math.max(2, sw(r.value))} height={15} rx={3} style={{ fill: 'var(--ch-parent)', opacity: 0.85 }} />
            <Txt x={90 + sw(r.value)} y={y + 11} size={10} mono>
              {bn(r.value)}
            </Txt>
          </g>
        );
      })}
      <Txt x={8} y={H - 8} size={10} color={C.accent} weight={600}>
        {`Together: ${bn(cx.total)} — the AI build-out's fuel`}
      </Txt>
    </Svg>
  );
}

/** Big Tech spends less → suppliers sell less → Indian suppliers get fewer orders. */
export function CapexCutIll({ bundle, result }: IllProps) {
  const live = isActive(result, ['capex', 'fullpop']);
  const c = paramValue(bundle, result, ['capex', 'fullpop'], 'c');
  const cut = live && isNum(result?.factors?.capex_cut_usd) && (result?.factors?.capex_cut_usd as number) > 0 ? (result!.factors.capex_cut_usd as number) : null;
  const steps = [
    { icon: 'cloud', color: 'var(--ch-parent)', t: ['Big Tech', 'spends less'] },
    { icon: 'chip', color: C.accent, t: ['chip & gear', 'makers sell less'] },
    { icon: 'server', color: 'var(--ch-capex)', t: ['Indian suppliers', 'get fewer orders'] },
  ];
  return (
    <Svg label="A capex cut: Big Tech spends less on AI data centres, so suppliers, including Indian ones, sell less">
      {steps.map((s, i) => {
        const x = 6 + i * 108;
        return (
          <g key={i}>
            <Box x={x} y={26} w={92} h={78} color={s.color} fill={C.card2}>
              <IconAt name={s.icon} x={x + 34} y={36} size={24} color={s.color} />
              <Txt x={x + 46} y={78} size={10} anchor="middle">
                {s.t[0]}
              </Txt>
              <Txt x={x + 46} y={91} size={10} anchor="middle" color={C.muted}>
                {s.t[1]}
              </Txt>
            </Box>
            {i < 2 && <Arrow x1={x + 94} y1={65} x2={x + 106} y2={65} color={C.text} head={5} />}
          </g>
        );
      })}
      {isNum(c) && (
        <Txt x={8} y={130} size={10.5} color={C.down} weight={600}>
          {`${live ? 'Your setting' : 'Default'}: AI spending cut by ${Math.round((c as number) * 100)}%`}
        </Txt>
      )}
      {cut !== null && (
        <Txt x={8} y={146} size={10} color={C.muted}>
          {`≈ ${bn(cut)} less than the last 12 months`}
        </Txt>
      )}
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        the cut is your assumption, not a forecast
      </Txt>
    </Svg>
  );
}

/** Who the hyperscalers are and what they buy. */
export function HyperscalerIll({ bundle }: IllProps) {
  const cx = hyperscalerCapex(bundle);
  const names = (cx?.rows.map((r) => COMPANY[r.ticker] ?? r.ticker) ?? ['Microsoft', 'Alphabet', 'Amazon', 'Meta', 'Oracle']).slice(0, 5);
  const buys = [
    { t: 'AI chips', icon: 'chip' },
    { t: 'servers', icon: 'server' },
    { t: 'power gear', icon: 'bolt' },
    { t: 'buildings', icon: 'factory' },
  ];
  return (
    <Svg label="Hyperscalers are the cloud giants that buy most AI chips, servers and power equipment">
      {names.map((n, i) => (
        <g key={n}>
          <rect x={6} y={14 + i * 26} width={78} height={20} rx={10} style={{ fill: C.card2, stroke: 'var(--ch-parent)' }} />
          <Txt x={45} y={28 + i * 26} size={9.5} anchor="middle">
            {n}
          </Txt>
          <Arrow x1={86} y1={24 + i * 26} x2={124} y2={78} color={C.faint} width={1} head={4} />
        </g>
      ))}
      <Box x={128} y={52} w={64} h={52} color={'var(--ch-parent)'} fill={C.card}>
        <IconAt name="cloud" x={148} y={58} size={24} color={'var(--ch-parent)'} />
        <Txt x={160} y={96} size={9} anchor="middle" color={C.muted}>
          buy
        </Txt>
      </Box>
      {buys.map((b, i) => (
        <g key={b.t}>
          <Arrow x1={194} y1={78} x2={226} y2={24 + i * 34} color={C.faint} width={1} head={4} />
          <IconAt name={b.icon} x={230} y={14 + i * 34} size={18} color={'var(--ch-capex)'} />
          <Txt x={252} y={27 + i * 34} size={9.5}>
            {b.t}
          </Txt>
        </g>
      ))}
      {cx && (
        <Txt x={8} y={H - 8} size={9.5} color={C.accent}>
          {`${bn(cx.total)} spent in the last 4 reported quarters`}
        </Txt>
      )}
    </Svg>
  );
}

/** Expected sales vs. lowered guidance, and peers falling in sympathy. */
export function GuidanceIll({ bundle, result }: IllProps) {
  const live = isActive(result, 'guidance');
  const g = paramValue(bundle, result, 'guidance', 'g');
  const tgt = paramValue(bundle, result, 'guidance', 'target');
  const who = typeof tgt === 'string' ? COMPANY[tgt] ?? tgt : 'A chipmaker';
  const cut = isNum(g) ? (g as number) : 0.2;
  const base = 128;
  const hExp = 92;
  const hNew = hExp * (1 - cut);
  return (
    <Svg label="A guidance cut: a company tells investors its future sales will be lower than expected">
      <Txt x={8} y={16} size={11} weight={600}>
        {`${who} lowers its sales outlook`}
      </Txt>
      <rect x={30} y={base - hExp} width={52} height={hExp} rx={4} style={{ fill: C.card2, stroke: C.muted }} />
      <rect x={100} y={base - hNew} width={52} height={hNew} rx={4} style={{ fill: 'var(--ch-revenue)', opacity: 0.85 }} />
      <rect x={100} y={base - hExp} width={52} height={hExp - hNew} rx={4} style={{ fill: C.downSoft, stroke: C.down, strokeDasharray: '3 2' }} />
      <Txt x={126} y={base - hNew + (hNew - hExp) / 2 + 4} size={10} anchor="middle" color={C.down} weight={600}>
        {`−${Math.round(cut * 100)}%`}
      </Txt>
      <Txt x={56} y={base + 14} size={9.5} anchor="middle" color={C.muted}>
        expected
      </Txt>
      <Txt x={126} y={base + 14} size={9.5} anchor="middle" color={C.muted}>
        new outlook
      </Txt>
      <Arrow x1={166} y1={84} x2={200} y2={84} color={C.text} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={210 + i * 36} y={70} width={28} height={28} rx={6} style={{ fill: C.card2, stroke: C.line }} />
          <IconAt name="trendDown" x={215 + i * 36} y={75} size={18} color={C.down} />
        </g>
      ))}
      <Txt x={260} y={116} size={9.5} anchor="middle" color={C.muted}>
        peers fall too
      </Txt>
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        {live ? 'size of the cut = your scenario setting' : isNum(g) ? 'default size of the cut (an assumption)' : 'example size'}
      </Txt>
    </Svg>
  );
}

/** A company restates profits; its own price takes the hit and peers wobble. */
export function RestatementIll({ bundle }: IllProps) {
  const cUs = bundle?.calibration?.contagion_us?.value;
  return (
    <Svg label="A restatement: a company admits past profits were wrong; trust falls and so does its share price">
      <Box x={10} y={18} w={110} h={120} color={'var(--ch-own)'} fill={C.card2}>
        <Txt x={22} y={40} size={10} color={C.muted}>
          Annual report
        </Txt>
        <line x1={22} y1={52} x2={108} y2={52} style={{ stroke: C.line }} />
        <Txt x={22} y={72} size={10}>
          Profit
        </Txt>
        <Txt x={104} y={72} size={11} anchor="end" mono color={C.muted}>
          100
        </Txt>
        <line x1={80} y1={68} x2={106} y2={68} style={{ stroke: C.down, strokeWidth: 1.6 }} />
        <Txt x={104} y={90} size={11} anchor="end" mono color={C.down} weight={600}>
          70
        </Txt>
        <IconAt name="warning" x={22} y={102} size={20} color={C.down} />
        <Txt x={48} y={117} size={9.5} color={C.down}>
          restated
        </Txt>
      </Box>
      <Arrow x1={126} y1={78} x2={168} y2={78} color={C.text} />
      <Box x={174} y={42} w={64} h={72} color={C.down} fill={C.downSoft}>
        <IconAt name="trendDown" x={194} y={52} size={24} color={C.down} />
        <Txt x={206} y={98} size={9.5} anchor="middle">
          its shares
        </Txt>
      </Box>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx={278} cy={40 + i * 38} r={13} style={{ fill: C.card2, stroke: C.line }} />
          <IconAt name="trendDown" x={270} y={32 + i * 38} size={16} color={'var(--ch-own)'} />
          <Arrow x1={240} y1={78} x2={263} y2={40 + i * 38} color={C.faint} width={1} head={4} />
        </g>
      ))}
      <Txt x={278} y={160} size={9} anchor="middle" color={C.muted}>
        peers wobble
      </Txt>
      {isNum(cUs) && (
        <Txt x={10} y={158} size={9} color={C.faint}>
          {`US peers moved ${fmtNum((cUs as number) * 100, 0)}% as much (SMCI, 2024)`}
        </Txt>
      )}
      {!isNum(cUs) && <SchematicTag x={W - 50} />}
    </Svg>
  );
}

/** Same earnings × a smaller P/E multiple = a lower price (uses a real origin). */
export function MultipleIll({ bundle, result }: IllProps) {
  const o = result?.origins.find((x) => x.ticker === 'NVDA' && isNum(x.pe0) && isNum(x.eps0)) ?? null;
  const s = bundle?.securities?.NVDA;
  const pe0 = o?.pe0 ?? s?.pe_ttm ?? null;
  const eps = o?.eps0 ?? s?.eps_ttm ?? null;
  const live = o && o.d > 0.001;
  const d = live ? o!.d : 0.2;
  const pe1 = isNum(pe0) ? (pe0 as number) * (1 - d) : null;
  const base = 130;
  const hs = scale(0, isNum(pe0) ? (pe0 as number) : 30, 0, 96);
  const h0 = hs(isNum(pe0) ? (pe0 as number) : 30);
  const h1 = hs(isNum(pe1) ? (pe1 as number) : 24);
  const name = o || s ? 'NVIDIA' : 'A stock';
  const price = (pe: number | null) => (isNum(pe) && isNum(eps) ? `$${fmtNum((pe as number) * (eps as number), 0)}` : '');
  return (
    <Svg label="Multiple compression: profits stay the same but investors pay a smaller multiple, so the price falls">
      <Txt x={8} y={16} size={11} weight={600}>
        {`${name}: same profit, smaller multiple`}
      </Txt>
      {[
        { x: 40, h: h0, pe: pe0, lab: 'today' },
        { x: 190, h: h1, pe: pe1, lab: live ? 'this scenario' : `example: −${Math.round(d * 100)}%` },
      ].map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={base - b.h} width={72} height={b.h} rx={4} style={{ fill: i ? 'var(--ch-premium)' : C.card2, stroke: i ? 'none' : C.muted, opacity: i ? 0.8 : 1 }} />
          <rect x={b.x} y={base - 16} width={72} height={16} rx={3} style={{ fill: C.up, opacity: 0.85 }} />
          <Txt x={b.x + 36} y={base - 5} size={9} anchor="middle" color={C.card} weight={600}>
            {isNum(eps) ? `EPS $${fmtNum(eps, 2)}` : 'EPS'}
          </Txt>
          <Txt x={b.x + 36} y={base - b.h - 6} size={10} anchor="middle" mono weight={600}>
            {isNum(b.pe) ? `${fmtNum(b.pe, 1)}× → ${price(b.pe as number)}` : '×P/E'}
          </Txt>
          <Txt x={b.x + 36} y={base + 14} size={9.5} anchor="middle" color={C.muted}>
            {b.lab}
          </Txt>
        </g>
      ))}
      <Arrow x1={120} y1={base - h0 / 2} x2={182} y2={base - h1 / 2} color={C.text} />
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        price = P/E × earnings per share (EPS)
      </Txt>
    </Svg>
  );
}

/** Debt-heavy AI borrowers: net debt in years of operating earnings (real), plus the spread shock. */
export function CreditIll({ bundle, result }: IllProps) {
  const rows = (bundle?.origins ?? [])
    .filter((o) => o.credit.stressed && isNum(o.credit.nd_ebitda))
    .map((o) => ({ t: o.ticker, v: o.credit.nd_ebitda as number }))
    .sort((a, c) => c.v - a.v)
    .slice(0, 4);
  const live = isActive(result, ['credit', 'fullpop']);
  const ds = paramValue(bundle, result, ['credit', 'fullpop'], 'ds_bps');
  const max = Math.max(4, ...rows.map((r) => r.v));
  const sw = scale(0, max, 0, 150);
  return (
    <Svg label="A credit event: debt-heavy AI companies must pay much more to borrow, so they cut spending">
      <Txt x={8} y={16} size={11} weight={600}>
        Debt-heavy AI borrowers
      </Txt>
      {rows.length ? (
        rows.map((r, i) => (
          <g key={r.t}>
            <Txt x={8} y={44 + i * 26} size={10}>
              {COMPANY[r.t] ?? r.t}
            </Txt>
            <rect x={84} y={33 + i * 26} width={sw(r.v)} height={15} rx={3} style={{ fill: 'var(--ch-credit)', opacity: 0.85 }} />
            <Txt x={90 + sw(r.v)} y={44 + i * 26} size={10} mono>
              {`${fmtNum(r.v, 1)}×`}
            </Txt>
          </g>
        ))
      ) : (
        <SchematicTag />
      )}
      <Txt x={8} y={44 + Math.max(rows.length, 1) * 26} size={9} color={C.faint}>
        net debt ÷ yearly operating earnings (EBITDA)
      </Txt>
      <IconAt name="bank" x={8} y={124} size={18} color={'var(--ch-credit)'} />
      <Txt x={32} y={137} size={10} color={C.text}>
        {isNum(ds) ? `${live ? 'Your setting' : 'Default'}: borrowing costs +${fmtNum((ds as number) / 100, 1)} pts` : 'Borrowing costs jump'}
      </Txt>
      <Txt x={32} y={152} size={9.5} color={C.muted}>
        → less money to buy chips and servers
      </Txt>
    </Svg>
  );
}

const WIN_SHORT: Record<string, string> = {
  DOTCOM: 'Dot-com 2000–02',
  DOTCOM12M: 'Dot-com, year 1',
  TELECOM: 'Telecom 2002',
  GFC: 'GFC 2008',
  COVID: 'COVID 2020',
  Y2022: '2022 bear',
  SMCI24: 'SMCI 2024',
  DEEPSEEK: 'DeepSeek day',
  NOV2025: 'NVDA Nov-2025',
  OCT2026: 'Oct-2026 scare',
};

/** Real US chip-index moves in each replayable past window. */
export function ReplayIll({ bundle, result }: IllProps) {
  const ws = (bundle?.history?.replay_windows ?? []).filter((w) => isNum(w.moves.SOX)).slice(0, 10);
  const cur = result?.params.preset === 'replay' ? String(result.params.values.window ?? '') : null;
  if (!ws.length) {
    return (
      <Svg label="A replay applies the real moves of a past crash to today">
        <IconAt name="clock" x={140} y={50} size={40} color={'var(--ch-parent)'} />
        <SchematicTag />
      </Svg>
    );
  }
  const vals = ws.map((w) => simple(w.moves.SOX as number));
  const min = Math.min(...vals, -0.1);
  const sw = scale(0, -min, 0, 150);
  const rowH = Math.min(13.5, 132 / ws.length);
  return (
    <Svg label="A replay takes the real fall in US chip stocks during a past crash and applies it to today">
      <Txt x={8} y={14} size={10.5} weight={600}>
        US chip index (SOX) in each past window
      </Txt>
      {ws.map((w, i) => {
        const v = vals[i];
        const y = 22 + i * rowH;
        const on = cur === w.id;
        return (
          <g key={w.id}>
            <Txt x={8} y={y + rowH * 0.72} size={9} color={on ? C.accent : C.text} weight={on ? 600 : 400}>
              {WIN_SHORT[w.id] ?? short(w.label, 16)}
            </Txt>
            <rect x={104} y={y + 1.5} width={Math.max(1.5, sw(Math.max(0, -v)))} height={rowH - 4} rx={2} style={{ fill: v < 0 ? C.down : C.up, opacity: on ? 1 : 0.7 }} />
            <Txt x={110 + sw(Math.max(0, -v))} y={y + rowH * 0.72} size={9} mono color={on ? C.accent : C.muted}>
              {pctWord(v, 0)}
            </Txt>
          </g>
        );
      })}
      <Txt x={8} y={H - 4} size={9} color={C.faint}>
        computed from index history, close to close
      </Txt>
    </Svg>
  );
}

/** Every leg at once: the combined US moves and the total hit to the Indian companies. */
export function FullPopIll({ result }: IllProps) {
  const f = result?.factors;
  const legs = [
    { t: 'AI spending cut', icon: 'server', color: 'var(--ch-capex)' },
    { t: 'AI stocks re-rated', icon: 'tag', color: 'var(--ch-premium)' },
    { t: 'AI debt squeeze', icon: 'bank', color: 'var(--ch-credit)' },
  ];
  const bars = f
    ? [
        { t: 'US chips (SOX)', v: f.SOX },
        { t: 'Nasdaq-100', v: f.NDX },
        { t: 'Nifty 50', v: f.NIFTY },
      ]
    : [];
  const live = result?.params.preset === 'fullpop';
  const sw = scale(0, 0.4, 0, 70);
  return (
    <Svg label="A full bubble pop: AI spending cuts, cheaper AI stocks and an AI debt squeeze all at once">
      {legs.map((l, i) => (
        <g key={l.t}>
          <rect x={6} y={14 + i * 32} width={112} height={24} rx={12} style={{ fill: C.card2, stroke: l.color }} />
          <IconAt name={l.icon} x={13} y={18 + i * 32} size={16} color={l.color} />
          <Txt x={34} y={30 + i * 32} size={9.5}>
            {l.t}
          </Txt>
          <Arrow x1={120} y1={26 + i * 32} x2={146} y2={58} color={C.faint} width={1.2} head={4} />
        </g>
      ))}
      <Box x={150} y={30} w={30} h={56} color={C.down} fill={C.downSoft}>
        <IconAt name="layers" x={156} y={48} size={18} color={C.down} />
      </Box>
      {bars.length ? (
        bars.map((b, i) => (
          <g key={b.t}>
            <Txt x={190} y={34 + i * 22} size={9} color={C.muted}>
              {b.t}
            </Txt>
            <rect x={190} y={38 + i * 22} width={Math.max(1.5, sw(Math.min(0.4, Math.abs(b.v))))} height={7} rx={2} style={{ fill: b.v < 0 ? C.down : C.up }} />
            <Txt x={196 + sw(Math.min(0.4, Math.abs(b.v)))} y={45 + i * 22} size={9} mono>
              {pctWord(b.v)}
            </Txt>
          </g>
        ))
      ) : (
        <Txt x={190} y={62} size={10} color={C.muted}>
          all legs combine
        </Txt>
      )}
      {result && (
        <>
          <Txt x={6} y={132} size={10} color={C.text}>
            {`${live ? 'This scenario' : 'Scenario on screen'}: Indian AI-linked stocks`}
          </Txt>
          <Txt x={6} y={148} size={11} color={result.totals.india_mcap_change_inr_cr < 0 ? C.down : C.up} weight={600} mono>
            {fmtCrore(result.totals.india_mcap_change_inr_cr)}
          </Txt>
        </>
      )}
      <Txt x={W - 6} y={H - 6} size={9} anchor="end" color={C.faint}>
        model output, not a forecast
      </Txt>
    </Svg>
  );
}
