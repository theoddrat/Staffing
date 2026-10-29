// "Data & sources" illustration: the four provenance labels with real counts from the bundle.
import type { Status } from '../../types/data';
import { statusCounts } from '../data';
import { C, H, IconAt, type IllProps, Svg, Txt } from './kit';

export const STATUS_VIS: Record<'SOURCED' | 'UNVERIFIED' | 'USER_ASSUMPTION' | 'COMPUTED', { label: string; blurb: string; icon: string; color: string }> = {
  SOURCED: { label: 'Sourced', blurb: 'from a cited document', icon: 'check', color: 'var(--g-up)' },
  UNVERIFIED: { label: 'Unverified', blurb: 'cited, not yet confirmed', icon: 'warning', color: 'var(--ch-credit)' },
  USER_ASSUMPTION: { label: 'Your assumption', blurb: 'a setting you can change', icon: 'sliders', color: 'var(--ch-capex)' },
  COMPUTED: { label: 'Computed', blurb: 'calculated from market data', icon: 'terminal', color: 'var(--ch-parent)' },
};

export function SourcesIll({ bundle, variant }: IllProps) {
  const counts = statusCounts(bundle);
  const keys = Object.keys(STATUS_VIS) as (keyof typeof STATUS_VIS)[];
  const focus = (variant as Status | undefined) ?? null;
  const prim = bundle?.sources.filter((s) => s.verification === 'PRIMARY').length ?? 0;
  return (
    <Svg label="Every number carries a label: sourced, unverified, your assumption, or computed">
      {keys.map((k, i) => {
        const v = STATUS_VIS[k];
        const x = 8 + (i % 2) * 156;
        const y = 8 + Math.floor(i / 2) * 66;
        const on = !focus || focus === k;
        const n = k === 'COMPUTED' ? counts.COMPUTED + counts.DERIVED : counts[k];
        return (
          <g key={k} style={{ opacity: on ? 1 : 0.35 }}>
            <rect x={x} y={y} width={148} height={58} rx={8} style={{ fill: C.card2, stroke: focus === k ? v.color : C.line, strokeWidth: focus === k ? 1.8 : 1 }} />
            <IconAt name={v.icon} x={x + 10} y={y + 10} size={18} color={v.color} />
            <Txt x={x + 34} y={y + 24} size={11} weight={600} color={v.color}>
              {v.label}
            </Txt>
            <Txt x={x + 10} y={y + 46} size={9.5} color={C.muted}>
              {v.blurb}
            </Txt>
            {bundle && (
              <Txt x={x + 140} y={y + 24} size={10} anchor="end" mono>
                {n}
              </Txt>
            )}
          </g>
        );
      })}
      <Txt x={8} y={H - 8} size={9.5} color={C.muted}>
        {bundle ? `${bundle.sources.length} cited sources (${prim} primary documents) · counts = labelled inputs` : 'every input carries one of these labels'}
      </Txt>
    </Svg>
  );
}
