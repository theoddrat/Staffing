// Small presentational building blocks shared by the F4/F5/F6 panels.
import type { ReactNode } from 'react';
import type { CrashType, DataBundle, Quantity, Source, Status } from '../../types/data';
import { SourceLinks, StatusBadge } from '../../components/StatusBadge';
import { bps, compact, isNum, num, pct, spct, times } from '../../lib/format';
import { CRASH_TYPE_LABEL, CRASH_TYPE_SHORT } from './util';

export interface TabDef {
  id: string;
  label: string;
}

export function SubTabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="b-tabs" role="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`b-tab${t.id === active ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="b-tab-n">{i + 1}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
  className,
  id,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`panel ${className ?? ''}`} id={id}>
      <div className="panel-header">
        <span>{title}</span>
        <span className="spacer" />
        {right}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** Explicit "no data" marker — never fabricate a placeholder number. */
export function Empty({ note }: { note: string }) {
  return (
    <div className="b-empty">
      <span className="white">—</span> <span className="muted">{note}</span>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="b-note">{children}</div>;
}

/** Format a value according to a Quantity / ParamSpec unit. */
export function fmtUnit(v: number | null | undefined, unit: string | null | undefined): string {
  if (!isNum(v)) return '—';
  switch (unit) {
    case 'frac':
      return pct(v, Math.abs(v) < 0.1 ? 2 : 1);
    case 'bps':
      return bps(v);
    case 'x':
      return times(v, Math.abs(v) < 1 ? 3 : 2);
    case 'usd':
      return `$${compact(v)}`;
    case 'inr':
      return `₹${compact(v)}`;
    case 'days':
      return `${num(v, 0)} d`;
    case 'yrs':
      return `${num(v, 1)} y`;
    default:
      return num(v, Math.abs(v) >= 100 ? 0 : 3);
  }
}

/** A quantity with its provenance badge and source links. */
export function QtyInline({ q, bundle, value, showParts = false }: { q: Quantity | null | undefined; bundle: DataBundle; value?: number | null; showParts?: boolean }) {
  if (!q) return <span className="muted">—</span>;
  const v = value === undefined ? q.value : value;
  const src = Array.from(new Set([...(q.src ?? []), ...(q.parts ?? []).flatMap((p) => p.src ?? [])]));
  return (
    <span className="b-qty">
      <span className="white num">{fmtUnit(v, q.unit)}</span>
      <StatusBadge status={q.status} title={q.note ?? q.status} />
      <SourceLinks ids={src} bundle={bundle} />
      {showParts && q.parts?.length > 1 ? (
        <span className="b-parts muted">
          {' = '}
          {q.parts.map((p, i) => (
            <span key={i} title={p.note ?? undefined}>
              {i > 0 ? ' × ' : ''}
              {fmtUnit(p.value, q.unit === 'frac' ? 'frac' : null)}
              <StatusBadge status={p.status} />
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** Regression coefficient with HAC t-stat; bold when |t| >= 1.96. */
export function CoefCell({ c, digits = 2 }: { c: { b: number; t: number } | null | undefined; digits?: number }) {
  if (!c || !isNum(c.b)) return <td className="num muted">—</td>;
  const sig = isNum(c.t) && Math.abs(c.t) >= 1.96;
  return (
    <td className={`num ${sig ? 'b-sig' : ''}`} title={isNum(c.t) ? `HAC t = ${c.t.toFixed(2)}` : undefined}>
      {num(c.b, digits)}
      <span className="b-t">({isNum(c.t) ? c.t.toFixed(1) : '—'})</span>
    </td>
  );
}

/** Signed simple-return cell with up/down colouring. */
export function MoveCell({ v, digits = 1, title }: { v: number | null | undefined; digits?: number; title?: string }) {
  // Round first so a tiny negative never renders as "-0.0%".
  const r = isNum(v) ? Math.round(v * 10 ** (digits + 2)) / 10 ** (digits + 2) : v;
  const shown = isNum(r) && r === 0 ? 0 : r;
  const cls = !isNum(shown) ? 'muted' : shown > 0 ? 'up' : shown < 0 ? 'down' : 'flat';
  return (
    <td className={`num ${cls}`} title={title}>
      {spct(shown, digits)}
    </td>
  );
}

export function CrashTags({ types }: { types: CrashType[] | null | undefined }) {
  if (!types?.length) return <span className="muted">—</span>;
  return (
    <span className="b-tags">
      {types.map((t) => (
        <span key={t} className={`b-tag b-tag-${t}`} title={CRASH_TYPE_LABEL[t] ?? t}>
          {CRASH_TYPE_SHORT[t] ?? t}
        </span>
      ))}
    </span>
  );
}

export function VerificationBadge({ v }: { v: Source['verification'] }) {
  return <span className={`badge b-ver b-ver-${v.toLowerCase()}`}>{v}</span>;
}

export function StatusLegend() {
  const rows: [Status, string][] = [
    ['SOURCED', 'Taken from a cited document (filing, fact sheet, exchange data, reputable report). Hover the [id] link for the verbatim quote.'],
    ['UNVERIFIED', 'Single weak or secondary source, conflicting sources, or could not be confirmed against a primary document.'],
    ['USER_ASSUMPTION', 'No source — a declared model default. Editable in the F5 assumption register; results recalculate live.'],
    ['COMPUTED', 'Calculated by the pipeline from downloaded market data (Yahoo Finance via yfinance; Shiller dataset).'],
    ['DERIVED', 'Product of components, each with its own status; the effective status is the weakest component.'],
  ];
  return (
    <table className="tbl b-legend">
      <tbody>
        {rows.map(([s, text]) => (
          <tr key={s}>
            <td style={{ width: 150 }}>
              <StatusBadge status={s} />
            </td>
            <td className="white">{text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
