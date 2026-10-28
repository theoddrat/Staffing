// F5 / OP LEVERAGE — operating leverage (incremental / current margin) used in Layer 1 and Layer 3.
import type { DataBundle } from '../../../types/data';
import { StatusBadge } from '../../../components/StatusBadge';
import { compact, num, pct } from '../../../lib/format';
import { Empty, Note, Section } from '../common';

interface Row {
  ticker: string;
  name: string;
  role: string;
}

export default function OpLeverage({ bundle }: { bundle: DataBundle }) {
  const rows: Row[] = [
    ...(bundle.origins ?? []).map((o) => ({ ticker: o.ticker, name: bundle.securities?.[o.ticker]?.name ?? o.ticker, role: `origin · ${o.group}` })),
    ...(bundle.india ?? []).map((t) => ({ ticker: t.ticker, name: t.name, role: `India · Tier ${t.tier}` })),
  ];
  if (!rows.length) return <Empty note="no securities in data.json" />;
  return (
    <Section title="Operating leverage, margins and revenue base">
      <div className="b-scroll-lg">
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th>TICKER</th>
              <th>NAME</th>
              <th>ROLE</th>
              <th className="num">OL</th>
              <th>STATUS</th>
              <th className="wrap">METHOD / NOTE</th>
              <th className="num">EBIT MARGIN</th>
              <th className="num">GROSS MARGIN</th>
              <th className="num">REVENUE TTM</th>
              <th>CCY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = bundle.securities?.[r.ticker];
              const q = s?.op_leverage;
              return (
                <tr key={r.ticker}>
                  <td className="lbl">{r.ticker}</td>
                  <td className="muted">{r.name}</td>
                  <td className="muted">{r.role}</td>
                  <td className="num white">{num(q?.value, 2)}</td>
                  <td>{q ? <StatusBadge status={q.status} title={q.note ?? undefined} /> : <span className="muted">—</span>}</td>
                  <td className="txt muted">{q?.note ?? (q?.parts?.map((p) => p.label).join(' × ') || '')}</td>
                  <td className="num">{pct(s?.ebit_margin, 1)}</td>
                  <td className="num">{pct(s?.gross_margin, 1)}</td>
                  <td className="num">{compact(s?.revenue_ttm, 1)}</td>
                  <td className="muted">{s?.currency ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note>
        OL = (ΔEBIT/ΔRevenue) ÷ (EBIT/Revenue) over the last two fiscal years, clamped to [1, 4]; when revenue barely moved or EBIT ≤ 0 the
        fallback is gross margin ÷ operating margin (fixed-opex approximation); otherwise a labelled USER ASSUMPTION of 1.5. Margins are trailing
        four quarters where available. All from company statements via Yahoo Finance (COMPUTED).
      </Note>
    </Section>
  );
}
