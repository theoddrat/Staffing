// "Customize" drawer: every dial of the current scenario with a plain label, a glossary link,
// a live sentence saying what the value means, its provenance tag and the range simulations try.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { DataBundle, ParamSpec } from '../../types/data';
import type { Horizon, ParamValue, PresetId, ScenarioResult } from '../../types/engine';
import { paramSpecs } from '../../engine';
import { isNum } from '../../lib/format';
import { HelpChip, Term } from '../../learn/Term';
import { Icon } from '../icons';
import { GBadge, Sources } from '../ui';
import type { GuidedProps } from '../types';
import { HORIZON_CHIP, pctAbs } from '../lib/format';
import { headlineItems } from '../lib/headline';
import { INTENSITY_LABEL, intensityCaption, levelOf, levelsFor, SHOCK_KEYS, type Intensity } from '../lib/intensity';
import { paramCopy, scenarioCopy, WINDOW_SHORT } from '../lib/scenarios';

const LEVELS: Intensity[] = ['mild', 'severe', 'extreme'];
const HORIZONS: Horizon[] = ['1D', '1M', '12M'];
const MODE_LABEL: Record<string, string> = {
  median: 'Back to the pre-ChatGPT level',
  calibrated: 'Like past bubbles (history)',
  multiple: 'A P/E I choose',
};

function dialValue(v: number, unit: string | null): string {
  switch (unit) {
    case 'frac':
      return pctAbs(v, Math.abs(v) < 0.1 && v !== 0 ? 1 : 0);
    case 'bps':
      return `${v.toFixed(0)} bps`;
    case 'yrs':
      return `${v.toFixed(v % 1 ? 1 : 0)} years`;
    case 'x':
      return `${v.toFixed(2)}×`;
    default:
      return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  }
}

/** A starting value when the user takes over an "automatic" dial. */
function autoStart(spec: ParamSpec, bundle: DataBundle, result: ScenarioResult): number {
  if (spec.key === 'f_override' && isNum(result.factors.inr_depr)) return result.factors.inr_depr;
  if (spec.key === 'contagion' && isNum(bundle.calibration?.contagion_us?.value)) return bundle.calibration.contagion_us.value!;
  return spec.min ?? 0;
}

function optionLabel(spec: ParamSpec, o: string, bundle: DataBundle): string {
  if (spec.kind === 'window') return WINDOW_SHORT[o] ?? bundle.history.replay_windows.find((w) => w.id === o)?.label ?? o;
  if (spec.kind === 'ticker') {
    const t = bundle.india.find((x) => x.ticker === o);
    if (t) return `${t.name} (India)`;
    return bundle.securities[o]?.name ? `${bundle.securities[o].name} (${o})` : o;
  }
  return MODE_LABEL[o] ?? o;
}

function Dial({
  spec,
  value,
  preset,
  values,
  bundle,
  result,
  onChange,
}: {
  spec: ParamSpec;
  value: ParamValue | undefined;
  preset: PresetId;
  values: Record<string, ParamValue>;
  bundle: DataBundle;
  result: ScenarioResult;
  onChange(v: ParamValue): void;
}) {
  const pc = paramCopy(spec.key, spec.label);
  const v = value === undefined ? spec.value : value;
  const say = pc.sentence?.(v ?? null, { bundle, preset, values }) ?? null;
  const mc = spec.mc && spec.mc.dist !== 'fixed' && isNum(spec.mc.low) && isNum(spec.mc.high) ? spec.mc : null;
  const id = `dial-${spec.key}`;
  let control: ReactNode;
  if (spec.kind === 'bool') {
    control = (
      <button type="button" role="switch" aria-checked={!!v} aria-labelledby={id} className={`g-switch${v ? ' is-on' : ''}`} onClick={() => onChange(!v)}>
        <span className="g-switch-knob" />
        <span className="g-switch-text">{v ? 'On' : 'Off'}</span>
      </button>
    );
  } else if (spec.kind === 'enum' && (spec.options?.length ?? 0) <= 4) {
    control = (
      <div className="g-pills" role="radiogroup" aria-labelledby={id}>
        {(spec.options ?? []).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={v === o} className={`g-pill${v === o ? ' is-on' : ''}`} onClick={() => onChange(o)}>
            {optionLabel(spec, o, bundle)}
          </button>
        ))}
      </div>
    );
  } else if (spec.kind === 'enum' || spec.kind === 'ticker' || spec.kind === 'window') {
    control = (
      <select className="g-select" aria-labelledby={id} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)}>
        {(spec.options ?? []).map((o) => (
          <option key={o} value={o}>
            {optionLabel(spec, o, bundle)}
          </option>
        ))}
      </select>
    );
  } else if (v === null || v === undefined) {
    control = (
      <div className="g-row">
        <span className="g-auto">
          <Icon name="check" size={14} /> Automatic
        </span>
        <button type="button" className="g-btn g-btn-small g-btn-ghost" onClick={() => onChange(autoStart(spec, bundle, result))}>
          Set it myself
        </button>
      </div>
    );
  } else {
    const min = spec.min ?? 0;
    const max = spec.max ?? 1;
    const step = spec.step ?? (max - min) / 100;
    const n = isNum(v) ? (v as number) : min;
    control = (
      <div className="g-range">
        <input type="range" min={min} max={max} step={step} value={n} aria-labelledby={id} aria-valuetext={dialValue(n, spec.unit)} onChange={(e) => onChange(parseFloat(e.target.value))} />
        <output className="g-range-val">{dialValue(n, spec.unit)}</output>
        {spec.value === null && (
          <button type="button" className="g-btn g-btn-small g-btn-ghost" onClick={() => onChange(null)}>
            Back to automatic
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="g-dial">
      <div className="g-dial-head">
        <span className="g-dial-label" id={id}>
          {pc.term ? <Term id={pc.term}>{pc.label}</Term> : pc.label}
        </span>
        <span className="g-dial-prov">
          <GBadge status={spec.status} />
          <Sources ids={spec.src} bundle={bundle} />
        </span>
      </div>
      {control}
      {say && <p className="g-dial-say">{say}</p>}
      {mc && spec.kind === 'number' && (
        <p className="g-dial-range">
          <Icon name="dice" size={13} /> Simulations also try {dialValue(mc.low!, spec.unit)} to {dialValue(mc.high!, spec.unit)}
        </p>
      )}
    </div>
  );
}

export default function CustomizeDrawer({ state, actions, onClose }: Omit<GuidedProps, 'openCustomize'> & { onClose(): void }) {
  const { bundle, params, result } = state;
  const specs = useMemo(() => paramSpecs(bundle, params.preset, params.horizon), [bundle, params.preset, params.horizon]);
  const levels = useMemo(() => levelsFor(bundle, params.preset, params.horizon, specs), [bundle, params.preset, params.horizon, specs]);
  const hasLevels = Object.keys(levels.severe).length > 0;
  const level = levelOf(levels, params.values, specs);
  const copy = scenarioCopy(params.preset);
  const isReplay = params.preset === 'replay';
  const shock = new Set(SHOCK_KEYS[params.preset] ?? []);
  const main = specs.filter((s) => shock.has(s.key) || s.kind === 'window' || s.kind === 'ticker' || s.key === 'mode');
  const more = specs.filter((s) => !main.includes(s));
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const setHorizon = (h: Horizon) => {
    if (level) actions.applyScenario(params.preset, h, levelsFor(bundle, params.preset, h, paramSpecs(bundle, params.preset, h))[level]);
    else actions.setHorizon(h);
  };
  const icons = { chips: 'chip', nifty: 'trendDown', india: 'rupee' } as const;

  return (
    <div className="g-overlay is-drawer" onClick={onClose}>
      <aside className="g-drawer" role="dialog" aria-modal="true" aria-labelledby="g-drawer-title" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <header className="g-drawer-head">
          <div>
            <p className="g-eyebrow">
              <Icon name="sliders" size={14} /> Customize the scenario
            </p>
            <h2 id="g-drawer-title" className="g-h2">
              {copy.title}
            </h2>
          </div>
          <button type="button" className="g-icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className="g-drawer-scroll">
          <ul className="g-preview is-live" aria-live="polite" aria-label="Result with these settings">
            {headlineItems(result).map((i) => (
              <li key={i.id}>
                <Icon name={icons[i.id]} size={14} />
                <span>{i.label}</span>
                <b>{i.value}</b>
              </li>
            ))}
          </ul>

          {!isReplay && (
            <section className="g-drawer-sec">
              {hasLevels && (
                <>
                  <h3 className="g-h3">How strong?</h3>
                  <div className="g-pills" role="radiogroup" aria-label="How strong">
                    {LEVELS.map((lv) => {
                      const cap = intensityCaption(params.preset, levels[lv]);
                      return (
                        <button
                          key={lv}
                          type="button"
                          role="radio"
                          aria-checked={level === lv}
                          className={`g-pill${level === lv ? ' is-on' : ''}`}
                          onClick={() => actions.setValues(levels[lv])}
                        >
                          <span>{INTENSITY_LABEL[lv]}</span>
                          {cap && <small>{cap}</small>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="g-muted g-small">
                    {level ? `${INTENSITY_LABEL[level]} = ` : 'Custom settings. '}
                    {level === 'mild'
                      ? 'the low end of the range the simulations sample.'
                      : level === 'extreme'
                        ? 'the high end of the range the simulations sample.'
                        : level === 'severe'
                          ? 'the central assumption.'
                          : 'Pick a level to snap back to the preset values.'}
                  </p>
                </>
              )}
              <h3 className="g-h3">
                Over what time? <HelpChip id="horizon" />
              </h3>
              <div className="g-pills" role="radiogroup" aria-label="Over what time">
                {HORIZONS.map((h) => (
                  <button key={h} type="button" role="radio" aria-checked={params.horizon === h} className={`g-pill${params.horizon === h ? ' is-on' : ''}`} onClick={() => setHorizon(h)}>
                    {HORIZON_CHIP[h]}
                  </button>
                ))}
              </div>
              {!state.result.preset.horizon_overrides && (
                <p className="g-muted g-small">For this scenario a longer time keeps the likely move but widens the range of outcomes.</p>
              )}
            </section>
          )}

          <section className="g-drawer-sec">
            <h3 className="g-h3">Main dials</h3>
            {main.map((s) => (
              <Dial key={s.key} spec={s} value={params.values[s.key]} preset={params.preset} values={params.values} bundle={bundle} result={result} onChange={(v) => actions.setValue(s.key, v)} />
            ))}
          </section>
          {more.length > 0 && (
            <details className="g-drawer-sec g-more">
              <summary>
                <Icon name="sliders" size={14} /> Fine-tuning ({more.length} more {more.length === 1 ? 'dial' : 'dials'})
              </summary>
              {more.map((s) => (
                <Dial key={s.key} spec={s} value={params.values[s.key]} preset={params.preset} values={params.values} bundle={bundle} result={result} onChange={(v) => actions.setValue(s.key, v)} />
              ))}
            </details>
          )}
          <p className="g-muted g-small">
            Tags: <GBadge status="SOURCED" /> from a cited document · <GBadge status="USER_ASSUMPTION" /> a judgement call you can change ·{' '}
            <GBadge status="COMPUTED" /> calculated from market data.
          </p>
        </div>

        <footer className="g-drawer-foot">
          <button type="button" className="g-btn g-btn-ghost" onClick={() => actions.applyScenario(params.preset, isReplay ? undefined : params.horizon, isReplay ? { window: String(params.values.window ?? '') } : {})}>
            Reset to defaults
          </button>
          <button
            type="button"
            className="g-btn g-btn-primary"
            onClick={() => {
              onClose();
              actions.setView('impact');
            }}
          >
            See who gets hit <Icon name="arrowRight" size={16} />
          </button>
        </footer>
      </aside>
    </div>
  );
}
