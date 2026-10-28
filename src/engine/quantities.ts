// Quantity lookup by id + user overrides + assumption detection.
import type { DataBundle, Quantity, Status } from '../types/data';
import type { EffectiveQuantity } from './types-extra';
import { isFiniteNum } from './util';

const ASSUMPTION_STATUSES: ReadonlySet<Status> = new Set<Status>(['USER_ASSUMPTION', 'UNVERIFIED']);

const indexCache = new WeakMap<DataBundle, Map<string, Quantity>>();

function add(map: Map<string, Quantity>, q: Quantity | null | undefined) {
  if (q && typeof q.id === 'string' && !map.has(q.id)) map.set(q.id, q);
}

/** Every Quantity in the bundle keyed by id (built once per bundle object). */
export function quantityIndex(bundle: DataBundle): Map<string, Quantity> {
  const hit = indexCache.get(bundle);
  if (hit) return hit;
  const map = new Map<string, Quantity>();
  for (const o of bundle.origins ?? []) {
    add(map, o.hyperscaler_share);
    add(map, o.neocloud_share);
  }
  for (const t of bundle.india ?? []) {
    for (const e of t.exposures ?? []) add(map, e.share);
    add(map, t.parent_stake);
    add(map, t.fx_margin_sens_bps);
  }
  for (const s of Object.values(bundle.securities ?? {})) add(map, s.op_leverage);
  for (const q of bundle.assumptions ?? []) add(map, q);
  if (bundle.calibration) {
    add(map, bundle.calibration.contagion_us);
    add(map, bundle.calibration.contagion_india);
  }
  if (bundle.fx) add(map, bundle.fx.default_f);
  indexCache.set(bundle, map);
  return map;
}

/** True when the quantity's value rests on USER_ASSUMPTION / UNVERIFIED inputs. */
export function restsOnAssumption(q: Quantity | null | undefined): boolean {
  if (!q) return false;
  if (ASSUMPTION_STATUSES.has(q.status)) return true;
  return (q.parts ?? []).some((p) => ASSUMPTION_STATUSES.has(p.status));
}

export function effective(
  q: Quantity | null | undefined,
  overrides: Record<string, number> | undefined,
  idHint?: string,
): EffectiveQuantity {
  const id = q?.id ?? idHint ?? '';
  const ov = overrides && id ? overrides[id] : undefined;
  if (isFiniteNum(ov)) {
    return { id, quantity: q ?? null, value: ov, status: 'USER_ASSUMPTION', overridden: true, assumption: true };
  }
  const value = q && isFiniteNum(q.value) ? q.value : null;
  return {
    id,
    quantity: q ?? null,
    value,
    status: q?.status ?? 'USER_ASSUMPTION',
    overridden: false,
    assumption: restsOnAssumption(q),
  };
}

/** Effective quantity by id (overrides applied). Unknown ids return value null. */
export function effectiveQuantity(
  bundle: DataBundle,
  overrides: Record<string, number> | undefined,
  id: string,
): EffectiveQuantity {
  return effective(quantityIndex(bundle).get(id), overrides, id);
}
