// F5 / ASSUMPTIONS — the assumption register: every USER ASSUMPTION / UNVERIFIED input, editable live.
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { DataBundle, ParamSpec, Preset, Quantity } from '../../../types/data';
import type { Horizon, ParamValue, ScenarioParams } from '../../../types/engine';
import type { AppActions } from '../../types';
import { SourceLinks, StatusBadge } from '../../../components/StatusBadge';
import { isNum } from '../../../lib/format';
import { fmtUnit, Note, Section } from '../common';
import { collectRegister, effectiveValue, sliderBounds, worstStatus } from '../util';

type GroupFilter = 'all' | 'global' | 'origin' | 'india' | 'calibration' | 'preset';
type StatusFilter = 'all' | 'USER_ASSUMPTION' | 'UNVERIFIED';

/** Default value of a preset param for the current horizon (fullpop has per-horizon overrides). */
export function paramDefault(preset: Preset | undefined, spec: ParamSpec, horizon: Horizon): ParamValue {
  const ov = preset?.horizon_overrides?.[horizon]?.[spec.key];
  return ov && ov.value !== undefined ? ov.value : spec.value;
}

function NumEditor({
  value,
  unit,
  bounds,
  overridden,
  onCommit,
  onReset,
}: {
  value: number | null;
  unit: string | null;
  bounds: { min: number; max: number; step: number };
  overridden: boolean;
  onCommit: (v: number) => void;
  onReset: () => void;
}) {
  const scale = unit === 'frac' ? 100 : 1;
  const [text, setText] = useState(isNum(value) ? String(+(value * scale).toFixed(4)) : '');
  useEffect(() => {
    setText(isNum(value) ? String(+(value * scale).toFixed(4)) : '');
  }, [value, scale]);
  const commitText = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onCommit(v / scale);
  };
  return (
    <span className="b-edit">
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={isNum(value) ? Math.min(bounds.max, Math.max(bounds.min, value)) : bounds.min}
        onChange={(e) => onCommit(parseFloat(e.target.value))}
        aria-label="adjust"
      />
      <input
        type="number"
        value={text}
        step={bounds.step * scale}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitText();
        }}
      />
      <span className="muted">{unit === 'frac' ? '%' : unit ?? ''}</span>
      <button className={`btn b-reset${overridden ? '' : ' muted'}`} onClick={onReset} disabled={!overridden} title="reset to the universe.yaml default">
        RESET
      </button>
    </span>
  );
}

function QuantityRow({ q, owner, group, bundle, params, actions }: { q: Quantity; owner: string; group: string; bundle: DataBundle; params: ScenarioParams; actions: AppActions }) {
  const eff = effectiveValue(q, params);
  const overridden = isNum(params?.overrides?.[q.id]);
  const status = worstStatus(q);
  const src = Array.from(new Set([...(q.src ?? []), ...(q.parts ?? []).flatMap((p) => p.src ?? [])]));
  const bounds = sliderBounds(q);
  return (
    <tr>
      <td className="lbl" title={q.id}>
        {owner}
        <div className="muted" style={{ fontSize: 9 }}>
          {q.id}
        </div>
      </td>
      <td className="muted">{group}</td>
      <td className="txt white">{q.label}</td>
      <td className={`num ${overridden ? 'b-overridden' : 'white'}`}>
        {fmtUnit(eff, q.unit)}
        {overridden ? <div className="muted">default {fmtUnit(q.value, q.unit)}</div> : null}
      </td>
      <td>
        <StatusBadge status={status} title={q.status} />
      </td>
      <td className="txt">
        {q.parts?.length ? (
          q.parts.map((p, i) => (
            <div key={i} title={p.note ?? undefined}>
              <span className="muted">{i ? '× ' : ''}</span>
              {p.label}: <span className="white">{fmtUnit(p.value, q.unit === 'frac' ? 'frac' : null)}</span>
              <StatusBadge status={p.status} />
              <SourceLinks ids={p.src ?? []} bundle={bundle} />
            </div>
          ))
        ) : (
          <SourceLinks ids={src} bundle={bundle} />
        )}
      </td>
      <td className="txt muted">{q.note ?? ''}</td>
      <td>
        <NumEditor value={eff} unit={q.unit} bounds={bounds} overridden={overridden} onCommit={(v) => actions.setOverride(q.id, v)} onReset={() => actions.setOverride(q.id, null)} />
      </td>
    </tr>
  );
}

function ParamRow({ spec, preset, bundle, params, actions }: { spec: ParamSpec; preset: Preset; bundle: DataBundle; params: ScenarioParams; actions: AppActions }) {
  const def = paramDefault(preset, spec, params.horizon);
  const cur = params.values?.[spec.key] ?? def;
  const overridden = cur !== def;
  let editor: ReactElement;
  if (spec.kind === 'number') {
    const b = sliderBounds({ min: spec.min, max: spec.max, step: spec.step, unit: spec.unit ?? '', value: typeof def === 'number' ? def : null });
    editor = (
      <NumEditor
        value={typeof cur === 'number' ? cur : null}
        unit={spec.unit}
        bounds={b}
        overridden={overridden}
        onCommit={(v) => actions.setValue(spec.key, v)}
        onReset={() => actions.setValue(spec.key, def)}
      />
    );
  } else if (spec.kind === 'bool') {
    editor = (
      <label className="b-edit">
        <input type="checkbox" checked={Boolean(cur)} onChange={(e) => actions.setValue(spec.key, e.target.checked)} /> {cur ? 'on' : 'off'}
      </label>
    );
  } else {
    editor = (
      <select value={String(cur ?? '')} onChange={(e) => actions.setValue(spec.key, e.target.value)}>
        {(spec.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const show = typeof cur === 'number' ? fmtUnit(cur, spec.unit) : String(cur ?? '—');
  return (
    <tr>
      <td className="lbl" title={`${preset.id}.${spec.key}`}>
        {preset.label}
        <div className="muted" style={{ fontSize: 9 }}>
          {preset.id}.{spec.key}
        </div>
      </td>
      <td className="muted">preset</td>
      <td className="txt white">{spec.label}</td>
      <td className={`num ${overridden ? 'b-overridden' : 'white'}`}>
        {show}
        {overridden ? <div className="muted">default {typeof def === 'number' ? fmtUnit(def, spec.unit) : String(def ?? '—')}</div> : null}
      </td>
      <td>
        <StatusBadge status={spec.status} />
      </td>
      <td className="txt">
        <SourceLinks ids={spec.src ?? []} bundle={bundle} />
        {spec.mc && spec.mc.dist !== 'fixed' ? (
          <div className="muted">
            MC {spec.mc.dist}: {fmtUnit(spec.mc.low, spec.unit)} … {fmtUnit(spec.mc.high, spec.unit)}
          </div>
        ) : null}
      </td>
      <td className="txt muted">{spec.note ?? ''}</td>
      <td>{editor}</td>
    </tr>
  );
}

export default function AssumptionRegister({ bundle, params, actions }: { bundle: DataBundle; params: ScenarioParams; actions: AppActions }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<GroupFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const rows = useMemo(() => collectRegister(bundle, params?.preset ?? null), [bundle, params?.preset]);
  const preset = (bundle.presets ?? []).find((p) => p.id === params?.preset);

  const filtered = rows.filter((r) => {
    if (group !== 'all' && r.group !== group) return false;
    const st = r.kind === 'quantity' ? worstStatus(r.q) : r.spec.status;
    if (status !== 'all' && st !== status) return false;
    if (search) {
      const s = search.toLowerCase();
      const hay = r.kind === 'quantity' ? `${r.id} ${r.owner} ${r.q.label} ${r.q.note ?? ''}` : `${r.id} ${r.owner} ${r.spec.label} ${r.spec.note ?? ''}`;
      if (!hay.toLowerCase().includes(s)) return false;
    }
    return true;
  });
  const counts = rows.reduce(
    (acc, r) => {
      const st = r.kind === 'quantity' ? worstStatus(r.q) : r.spec.status;
      if (st === 'USER_ASSUMPTION') acc.ua += 1;
      if (st === 'UNVERIFIED') acc.uv += 1;
      return acc;
    },
    { ua: 0, uv: 0 },
  );
  const nOverrides = Object.keys(params?.overrides ?? {}).length;

  return (
    <Section
      title={`Assumption register — ${counts.ua} USER ASSUMPTION · ${counts.uv} UNVERIFIED · ${nOverrides} user override${nOverrides === 1 ? '' : 's'} active`}
    >
      <div className="b-toolbar">
        <input className="b-search" type="text" placeholder="search id / company / label…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>group</label>
        <select value={group} onChange={(e) => setGroup(e.target.value as GroupFilter)}>
          <option value="all">all</option>
          <option value="global">global model</option>
          <option value="origin">shock origins</option>
          <option value="india">India targets</option>
          <option value="calibration">calibration</option>
          <option value="preset">active preset</option>
        </select>
        <label>status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">all</option>
          <option value="USER_ASSUMPTION">USER ASSUMPTION</option>
          <option value="UNVERIFIED">UNVERIFIED</option>
        </select>
        <label title="When on, a stock trading below its pre-ChatGPT P/E is not re-rated upward in an AI-premium unwind">
          <input type="checkbox" checked={params?.premiumFloorZero ?? true} onChange={(e) => actions.setPremiumFloor(e.target.checked)} /> floor AI-premium unwind at 0
        </label>
        <StatusBadge status="USER_ASSUMPTION" />
      </div>
      <div className="b-scroll-lg" style={{ maxHeight: 700 }}>
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th>OWNER / ID</th>
              <th>GROUP</th>
              <th className="wrap">WHAT</th>
              <th className="num">VALUE</th>
              <th>STATUS</th>
              <th className="wrap">COMPONENTS / SOURCES</th>
              <th className="wrap">NOTE</th>
              <th>EDIT (LIVE)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) =>
              r.kind === 'quantity' ? (
                <QuantityRow key={r.id} q={r.q} owner={r.owner} group={r.group} bundle={bundle} params={params} actions={actions} />
              ) : preset ? (
                <ParamRow key={r.id} spec={r.spec} preset={preset} bundle={bundle} params={params} actions={actions} />
              ) : null,
            )}
            {!filtered.length ? (
              <tr>
                <td colSpan={8} className="muted">
                  — no rows match the filter
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Note>
        Every number here is either an explicit model default with no source (USER ASSUMPTION) or rests on a weak/secondary/conflicting source
        (UNVERIFIED). Edits apply immediately to the scenario in F1–F3 (overrides are kept per session). A DERIVED quantity's override replaces the
        product of its components. Preset parameters are listed for the active preset only ({preset?.label ?? '—'}).
      </Note>
    </Section>
  );
}
