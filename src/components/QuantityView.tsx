// Renders a Quantity (value + effective status + sources) and, optionally, its multiplicative parts.
import type { DataBundle, Quantity } from '../types/data';
import { StatusBadge, SourceLinks } from './StatusBadge';
import { isNum, pct } from '../lib/format';

export function fmtQuantity(q: { value: number | null; unit: string }): string {
  const v = q.value;
  if (!isNum(v)) return '—';
  switch (q.unit) {
    case 'frac':
      return pct(v, 1);
    case 'bps':
      return `${v.toFixed(0)} bps`;
    case 'x':
      return `${v.toFixed(2)}x`;
    case 'yrs':
      return `${v.toFixed(1)} yrs`;
    case 'days':
      return `${v.toFixed(0)} d`;
    case 'usd':
      return `$${(v / 1e9).toFixed(1)}B`;
    default:
      return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3);
  }
}

export default function QuantityView({
  q,
  bundle,
  showParts = false,
  override,
}: {
  q: Quantity | null | undefined;
  bundle: DataBundle;
  showParts?: boolean;
  override?: number;
}) {
  if (!q) return <span className="muted">—</span>;
  const shown = override != null ? { ...q, value: override } : q;
  return (
    <span className="qty" title={q.note ?? undefined}>
      <span className="white">{fmtQuantity(shown)}</span>
      {override != null && <span className="badge badge-user_assumption">EDITED</span>}
      <StatusBadge status={q.status} />
      <SourceLinks ids={q.src} bundle={bundle} />
      {showParts && q.parts.length > 1 && (
        <span className="qty-parts">
          {' = '}
          {q.parts.map((p, i) => (
            <span key={i} className="qty-part" title={p.note ?? undefined}>
              {i > 0 && ' × '}
              <span className="white">{fmtQuantity({ value: p.value, unit: q.unit === 'frac' ? 'frac' : q.unit })}</span>{' '}
              <span className="muted">({p.label})</span>
              <StatusBadge status={p.status} />
              <SourceLinks ids={p.src} bundle={bundle} />
            </span>
          ))}
        </span>
      )}
      {showParts && q.parts.length === 1 && q.parts[0].label && <span className="muted"> ({q.parts[0].label})</span>}
    </span>
  );
}
