// "Past crashes" illustrations: drawdown (real overlay), CAR (real event study), the event-study
// method, and contagion (real calibration cases).
import type { EventStudy } from '../../types/data';
import { isNum } from '../../lib/format';
import { fmtNum, overlay, pctWord, short } from '../data';
import { Arrow, C, H, type IllProps, linePath, scale, SchematicTag, Svg, Txt, W } from './kit';

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m] = d.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] ?? '';
  return `${mon}-${y}`;
};

/** Dot-com Nasdaq-100 vs today's Nasdaq-100, both indexed to 100 at their peak (real data). */
export function DrawdownIll({ bundle, compact }: IllProps) {
  const old = overlay(bundle, '^NDX', false) ?? overlay(bundle, '^IXIC', false);
  const now = overlay(bundle, '^NDX', true) ?? overlay(bundle, '^SOX', true);
  const t0 = -250;
  const t1 = 750;
  const win = (s: typeof old) =>
    s ? s.t.map((t, i) => ({ t, v: s.v[i] })).filter((p) => p.t >= t0 && p.t <= t1 && isNum(p.v)) : [];
  const a = win(old);
  const b = win(now);
  if (a.length < 10) {
    return (
      <Svg label="Drawdown: the fall from a peak to the lowest point after it">
        <path d="M20,40 L80,30 L120,90 L170,130 L230,100 L300,60" style={{ fill: 'none', stroke: C.accent, strokeWidth: 2 }} />
        <SchematicTag />
      </Svg>
    );
  }
  const vals = [...a, ...b].map((p) => p.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals, 100);
  const L = 30;
  const R = W - 10;
  const T = 30;
  const B = H - 26;
  const sx = scale(t0, t1, L, R);
  const sy = scale(lo * 0.92, hi * 1.04, B, T);
  const trough = a.reduce((m, p) => (p.v < m.v ? p : m), a[0]);
  const dd = trough.v / 100 - 1;
  const caseDd = bundle?.history?.cases
    .flatMap((c) => c.drawdowns)
    .find((d) => d.ticker === old!.ticker && d.peak_date === old!.peak_date);
  const last = b[b.length - 1];
  return (
    <Svg label="Drawdown: how far an index fell from its peak to its lowest point, dot-com versus today">
      <Txt x={8} y={14} size={10.5} weight={600}>
        Fall from the peak: dot-com vs today (Nasdaq-100)
      </Txt>
      <line x1={sx(0)} y1={T - 4} x2={sx(0)} y2={B} style={{ stroke: C.line, strokeDasharray: '3 3' }} />
      <Txt x={sx(0) + 3} y={T + 2} size={8.5} color={C.faint}>
        peak = 100
      </Txt>
      <line x1={L} y1={sy(100)} x2={R} y2={sy(100)} style={{ stroke: C.line }} />
      <path d={linePath(a.map((p) => [sx(p.t), sy(p.v)]))} style={{ fill: 'none', stroke: C.muted, strokeWidth: 1.6 }} />
      {b.length > 1 && <path d={linePath(b.map((p) => [sx(p.t), sy(p.v)]))} style={{ fill: 'none', stroke: C.accent, strokeWidth: 2 }} />}
      <Arrow x1={sx(trough.t)} y1={sy(100)} x2={sx(trough.t)} y2={sy(trough.v) - 3} color={C.down} width={1.6} />
      <circle cx={sx(trough.t)} cy={sy(trough.v)} r={3.5} style={{ fill: C.down }} />
      <Txt x={sx(trough.t) - 6} y={sy((100 + trough.v) / 2)} size={10} anchor="end" color={C.down} weight={600}>
        {`drawdown ${pctWord(caseDd && isNum(caseDd.drawdown) ? caseDd.drawdown : dd, 0)}`}
      </Txt>
      {!compact && caseDd?.trough_date && (
        <Txt x={sx(trough.t) - 6} y={sy((100 + trough.v) / 2) + 12} size={9} anchor="end" color={C.muted}>
          {`bottom ${fmtDate(caseDd.trough_date)}${caseDd.recovered_date ? `, back to peak ${fmtDate(caseDd.recovered_date)}` : ''}`}
        </Txt>
      )}
      {last && (
        <Txt x={sx(last.t) + 5} y={sy(last.v) - 6} size={9.5} color={C.accent} weight={600}>
          {`today ${pctWord(last.v / 100 - 1, 0)}`}
        </Txt>
      )}
      <Txt x={L} y={H - 12} size={9} color={C.faint}>
        −1 year
      </Txt>
      <Txt x={R} y={H - 12} size={9} color={C.faint} anchor="end">
        +3 years (trading days from the peak)
      </Txt>
      <Txt x={W / 2} y={H - 2} size={8.5} color={C.faint} anchor="middle">
        grey: dot-com (peak 2000) · amber: today
      </Txt>
    </Svg>
  );
}

const GROUP_COLORS = ['var(--ch-parent)', 'var(--tier-c)', 'var(--tier-b)', 'var(--tier-d)', 'var(--ch-fpi)'];

export function groupShort(name: string) {
  return short(name.replace(/\s*\((vs|[0-9]).*?\)\s*/gi, ' ').trim(), 26);
}

/** Mean cumulative abnormal return per group around a real AI shock (default: DeepSeek). */
export function CarIll({ bundle, variant, compact }: IllProps) {
  const studies = bundle?.history?.event_studies ?? [];
  const es: EventStudy | null = studies.find((e) => e.id === (variant ?? 'es_deepseek')) ?? studies.find((e) => e.id === 'es_deepseek') ?? studies[0] ?? null;
  if (!es) {
    return (
      <Svg label="Cumulative abnormal return: the extra fall beyond what the market explains, added up day by day">
        <SchematicTag />
      </Svg>
    );
  }
  return <EventChart es={es} compact={compact} />;
}

/** Shared mini event-study chart (used by CarIll and the history story card). */
export function EventChart({ es, compact, maxDay = 60 }: { es: EventStudy; compact?: boolean; maxDay?: number }) {
  const [d0] = es.window;
  const groups = es.groups.slice(0, 3).map((g, i) => ({
    name: groupShort(g.name),
    color: GROUP_COLORS[i % GROUP_COLORS.length],
    pts: g.mean_car.map((v, k) => ({ d: d0 + k, v })).filter((p): p is { d: number; v: number } => isNum(p.v) && p.d <= maxDay),
  }));
  const vals = groups.flatMap((g) => g.pts.map((p) => p.v));
  if (!vals.length) {
    return (
      <Svg label={`${es.label}: no event-study data`}>
        <SchematicTag />
      </Svg>
    );
  }
  const lo = Math.min(...vals, -0.02);
  const hi = Math.max(...vals, 0.02);
  const legendH = 13 * groups.length;
  const L = 34;
  const R = W - 42;
  const T = 22 + legendH;
  const B = H - 22;
  const sx = scale(d0, maxDay, L, R);
  const sy = scale(lo * 1.08, hi * 1.08, B, T);
  return (
    <Svg label={`${es.label}: cumulative abnormal return by group, ${d0} to +${maxDay} trading days`}>
      <Txt x={8} y={13} size={10.5} weight={600}>
        {short(es.label, 50)}
      </Txt>
      {groups.map((g, i) => (
        <g key={g.name}>
          <rect x={8} y={20 + i * 13} width={12} height={4} rx={2} style={{ fill: g.color }} />
          <Txt x={24} y={25 + i * 13} size={9} color={C.muted}>
            {g.name}
          </Txt>
        </g>
      ))}
      <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} style={{ stroke: C.line }} />
      <line x1={sx(0)} y1={T - 2} x2={sx(0)} y2={B} style={{ stroke: C.muted, strokeDasharray: '3 3' }} />
      <Txt x={sx(0) + 3} y={B - 3} size={8.5} color={C.muted}>
        event day
      </Txt>
      {groups.map((g) => {
        const end = g.pts[g.pts.length - 1];
        return (
          <g key={g.name}>
            <path d={linePath(g.pts.map((p) => [sx(p.d), sy(p.v)]))} style={{ fill: 'none', stroke: g.color, strokeWidth: 1.8 }} />
            {end && !compact && (
              <Txt x={sx(end.d) + 4} y={sy(end.v) + 3} size={9} mono color={g.color}>
                {pctWord(end.v, 0)}
              </Txt>
            )}
          </g>
        );
      })}
      <Txt x={L - 4} y={sy(0) + 3} size={8.5} anchor="end" color={C.faint} mono>
        0%
      </Txt>
      <Txt x={L} y={H - 8} size={9} color={C.faint}>
        {`${d0} days`}
      </Txt>
      <Txt x={R} y={H - 8} size={9} color={C.faint} anchor="end">
        {`+${maxDay} trading days`}
      </Txt>
    </Svg>
  );
}

/** Method: actual vs expected around the event; the gaps add up to the CAR (schematic). */
export function EventStudyIll() {
  const sx = scale(-5, 20, 28, W - 70);
  const exp = (d: number) => 0.002 * d;
  const act = (d: number) => (d < 0 ? exp(d) + 0.003 * Math.sin(d) : exp(d) - 0.07 - 0.002 * d);
  const days = Array.from({ length: 26 }, (_, i) => i - 5);
  const sy = scale(-0.13, 0.05, 140, 26);
  const gap = `${linePath(days.filter((d) => d >= 0).map((d) => [sx(d), sy(exp(d))]))} ${linePath(
    days
      .filter((d) => d >= 0)
      .reverse()
      .map((d): [number, number] => [sx(d), sy(act(d))]),
  ).replace('M', 'L')} Z`;
  return (
    <Svg label="Event study: compare what a stock actually did after an event with what the market alone predicted">
      <path d={gap} style={{ fill: C.downSoft }} />
      <path d={linePath(days.map((d) => [sx(d), sy(exp(d))]))} style={{ fill: 'none', stroke: C.muted, strokeWidth: 1.6, strokeDasharray: '5 3' }} />
      <path d={linePath(days.map((d) => [sx(d), sy(act(d))]))} style={{ fill: 'none', stroke: C.accent, strokeWidth: 2 }} />
      <line x1={sx(0)} y1={22} x2={sx(0)} y2={146} style={{ stroke: C.line, strokeDasharray: '3 3' }} />
      <Txt x={sx(0) + 3} y={30} size={9} color={C.muted}>
        event
      </Txt>
      <Txt x={sx(20) + 4} y={sy(exp(20)) + 3} size={9} color={C.muted}>
        expected
      </Txt>
      <Txt x={sx(20) + 4} y={sy(act(20)) + 3} size={9} color={C.accent}>
        actual
      </Txt>
      <Txt x={sx(10)} y={sy((exp(10) + act(10)) / 2) + 3} size={9.5} anchor="middle" color={C.down} weight={600}>
        abnormal
      </Txt>
      <Txt x={8} y={14} size={10.5} weight={600}>
        Actual vs what the market alone predicts
      </Txt>
      <Txt x={8} y={H - 6} size={9} color={C.faint}>
        add up the daily gaps → cumulative abnormal return
      </Txt>
      <SchematicTag x={W - 6} y={H - 18} />
    </Svg>
  );
}

/** Real contagion calibrations: how much peers moved relative to the company in trouble. */
export function ContagionIll({ bundle }: IllProps) {
  const cases = [
    { q: bundle?.calibration?.contagion_us, title: 'US: Super Micro, Oct-2024', who: 'chip peers' },
    { q: bundle?.calibration?.contagion_india, title: 'India: Satyam, Jan-2009', who: 'IT peers' },
  ];
  return (
    <Svg label="Contagion: when one company's trust collapses, how much its peers fall with it">
      {cases.map((c, i) => {
        const x0 = 8 + i * 158;
        const cx = x0 + 74;
        const cy = 74;
        const peers = c.q?.parts?.[0]?.value;
        const inv = c.q?.parts?.[1]?.value;
        const tgtMove = isNum(inv) && Math.abs(inv as number) > 1e-9 ? 1 / (inv as number) : null;
        const ratio = c.q?.value;
        return (
          <g key={c.title}>
            <Txt x={x0} y={14} size={10} weight={600}>
              {c.title}
            </Txt>
            {[30, 44, 58].map((r) => (
              <circle key={r} cx={cx} cy={cy} r={r} style={{ fill: 'none', stroke: C.down, opacity: 0.12 + (58 - r) / 140 }} />
            ))}
            <circle cx={cx} cy={cy} r={18} style={{ fill: C.downSoft, stroke: C.down, strokeWidth: 1.5 }} />
            <Txt x={cx} y={cy + 4} size={10} anchor="middle" mono weight={600} color={C.down}>
              {isNum(tgtMove) ? pctWord(tgtMove as number, 0) : '↓'}
            </Txt>
            {Array.from({ length: 5 }, (_, k) => {
              const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
              return <circle key={k} cx={cx + 50 * Math.cos(a)} cy={cy + 50 * Math.sin(a)} r={6.5} style={{ fill: C.card2, stroke: C.muted }} />;
            })}
            <Txt x={x0} y={146} size={9.5}>
              {isNum(peers) ? `${c.who}: ${pctWord(peers as number, 1)} (vs market)` : c.who}
            </Txt>
            <Txt x={x0} y={160} size={9.5} color={C.accent} weight={600}>
              {isNum(ratio) ? `ratio ${fmtNum(ratio, (ratio as number) < 0.01 ? 4 : 2)}` : ''}
            </Txt>
          </g>
        );
      })}
    </Svg>
  );
}
