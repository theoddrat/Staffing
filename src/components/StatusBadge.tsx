// Provenance badges. Every non-computed number shown in the UI should sit next to one of these.
import type { DataBundle, Source, Status } from '../types/data';

const LABEL: Record<Status, string> = {
  SOURCED: 'SRC',
  UNVERIFIED: 'UNVERIFIED',
  USER_ASSUMPTION: 'USER ASSUMPTION',
  COMPUTED: 'CALC',
  DERIVED: 'DERIVED',
};

export function StatusBadge({ status, title }: { status: Status; title?: string }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`} title={title ?? status}>
      {LABEL[status]}
    </span>
  );
}

/** Small superscript links to sources, e.g. [nvda_q2fy27_cfo]. Tooltip shows the verbatim quote. */
export function SourceLinks({ ids, bundle }: { ids: string[]; bundle: DataBundle }) {
  if (!ids?.length) return null;
  const byId = new Map<string, Source>(bundle.sources.map((s) => [s.id, s]));
  return (
    <span className="src-links">
      {ids.map((id) => {
        const s = byId.get(id);
        if (!s) return (
          <span key={id} className="src-missing" title="source id not found in bundle.sources">[{id}?]</span>
        );
        const tip = `${s.title}${s.publisher ? ' — ' + s.publisher : ''}${s.date ? ' (' + s.date + ')' : ''}${
          s.quote ? '\n“' + s.quote + '”' : ''
        }`;
        return (
          <a key={id} href={s.url} target="_blank" rel="noreferrer" title={tip} className="src-link">
            [{id}]
          </a>
        );
      })}
    </span>
  );
}
