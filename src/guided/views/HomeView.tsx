// ① Pick a scenario: a short intro, a picture of how a shock reaches India, and one illustrated
// card per scenario with Mild / Severe / Extreme, a time chip and a live headline preview.
import { useMemo, useState } from 'react';
import type { Horizon, ParamValue, ScenarioResult } from '../../types/engine';
import { defaultParams, horizonForWindow, paramSpecs, runScenario } from '../../engine';
import { paramsKey } from '../../state/store';
import { Term } from '../../learn/Term';
import { Icon } from '../icons';
import { ScenarioArt } from '../art';
import { Callout, StepNum } from '../ui';
import type { GuidedProps } from '../types';
import { HORIZON_CHIP } from '../lib/format';
import { headlineItems, isFlat } from '../lib/headline';
import { INTENSITY_LABEL, intensityCaption, levelOf, levelsFor, SHOCK_KEYS, type Intensity } from '../lib/intensity';
import { PARAM_COPY, SCENARIOS, WINDOW_SHORT, type ScenarioCopy } from '../lib/scenarios';

const LEVELS: Intensity[] = ['mild', 'severe', 'extreme'];
const HORIZONS: Horizon[] = ['1D', '1M', '12M'];

function HowItReachesIndia({ n, us }: { n: number; us: number }) {
  return (
    <ol className="g-mini-flow" aria-label="How a shock reaches India">
      <li className="g-mini-step">
        <span className="g-mini-ic">
          <Icon name="chip" size={22} color="var(--g-accent)" />
          <Icon name="cloud" size={22} color="var(--ch-parent)" />
        </span>
        <b>A shock hits US AI stocks</b>
        <small>you choose which one, among {us} US AI companies</small>
      </li>
      <li className="g-mini-arrow" aria-hidden="true">
        <svg viewBox="0 0 40 12">
          <path d="M0 6h34" className="g-mini-dash" />
          <path d="M30 1l6 5-6 5" />
        </svg>
      </li>
      <li className="g-mini-step">
        <span className="g-mini-ic">
          <Icon name="pulse" size={22} color="var(--ch-sentiment)" />
          <Icon name="globe" size={22} color="var(--ch-fpi)" />
          <Icon name="server" size={22} color="var(--ch-capex)" />
        </span>
        <b>
          It travels through <Term id="channel">channels</Term>
        </b>
        <small>investor mood, parent companies, orders, foreign money, the rupee</small>
      </li>
      <li className="g-mini-arrow" aria-hidden="true">
        <svg viewBox="0 0 40 12">
          <path d="M0 6h34" className="g-mini-dash" />
          <path d="M30 1l6 5-6 5" />
        </svg>
      </li>
      <li className="g-mini-step">
        <span className="g-mini-ic">
          <Icon name="building" size={22} color="var(--tier-a)" />
          <Icon name="laptop" size={22} color="var(--tier-b)" />
        </span>
        <b>Indian companies feel it</b>
        <small>{n} listed companies, ranked by how hard they could be hit</small>
      </li>
    </ol>
  );
}

function Preview({ r }: { r: ScenarioResult | null }) {
  if (!r) return <p className="g-preview is-empty">No preview for this choice.</p>;
  if (isFlat(r))
    return (
      <p className="g-preview is-flat">
        <Icon name="warning" size={16} /> Barely moves at today’s prices — open the card to see why.
      </p>
    );
  const icons = { chips: 'chip', nifty: 'trendDown', india: 'rupee' } as const;
  return (
    <ul className="g-preview" aria-label="What this scenario does">
      {headlineItems(r).map((i) => (
        <li key={i.id}>
          <Icon name={icons[i.id]} size={14} />
          <span>{i.label}</span>
          <b>{i.value}</b>
        </li>
      ))}
    </ul>
  );
}

function ScenarioCard({ copy, state, actions, openCustomize }: GuidedProps & { copy: ScenarioCopy }) {
  const { bundle, params, result } = state;
  const isCurrent = params.preset === copy.id;
  const isReplay = copy.id === 'replay';
  const defH = useMemo(() => defaultParams(bundle, copy.id).horizon, [bundle, copy.id]);
  const [h, setH] = useState<Horizon>(isCurrent ? params.horizon : defH);
  const specs = useMemo(() => paramSpecs(bundle, copy.id, h), [bundle, copy.id, h]);
  const levels = useMemo(() => levelsFor(bundle, copy.id, h, specs), [bundle, copy.id, h, specs]);
  const hasLevels = Object.keys(levels.severe).length > 0;
  const [level, setLevel] = useState<Intensity | 'custom'>(() => (isCurrent ? levelOf(levels, params.values, specs) ?? 'custom' : 'severe'));
  const winSpec = specs.find((s) => s.kind === 'window');
  const [win, setWin] = useState<string>(() =>
    isCurrent && typeof params.values.window === 'string' ? params.values.window : String(winSpec?.value ?? winSpec?.options?.[0] ?? ''),
  );

  const values = useMemo<Record<string, ParamValue> | null>(() => {
    if (isReplay) return win ? { window: win } : {};
    if (level === 'custom') return null;
    return levels[level];
  }, [isReplay, win, level, levels]);

  const preview = useMemo(() => {
    if (values === null) return isCurrent ? result : null;
    try {
      const hh = isReplay ? horizonForWindow(bundle, win) : h;
      const p0 = defaultParams(bundle, copy.id, hh);
      return runScenario(bundle, { ...p0, values: { ...p0.values, ...values }, overrides: params.overrides, premiumFloorZero: params.premiumFloorZero });
    } catch {
      return null;
    }
  }, [values, isCurrent, result, isReplay, bundle, win, h, copy.id, params.overrides, params.premiumFloorZero]);

  const mainKey = isReplay ? 'window' : SHOCK_KEYS[copy.id]?.[0];
  const mainVal = isReplay ? win : values ? values[mainKey] : params.values[mainKey];
  const sentence =
    mainKey && PARAM_COPY[mainKey]?.sentence
      ? PARAM_COPY[mainKey].sentence!(mainVal ?? null, { bundle, preset: copy.id, values: { ...params.values, ...(values ?? {}) } })
      : null;

  const commit = () => {
    if (values !== null) actions.applyScenario(copy.id, isReplay ? undefined : h, values);
  };
  const lowConf = bundle.presets.find((p) => p.id === copy.id)?.low_confidence;
  const titleId = `sc-${copy.id}`;

  return (
    <article className={`g-scard${isCurrent ? ' is-current' : ''}`} aria-labelledby={titleId}>
      <div className="g-scard-art">
        <ScenarioArt art={copy.art} />
        {isCurrent && (
          <span className="g-scard-flag">
            <Icon name="check" size={14} /> Current
          </span>
        )}
      </div>
      <div className="g-scard-body">
        <h3 id={titleId} className="g-scard-title">
          {copy.title}
        </h3>
        <p className="g-scard-blurb">
          {copy.blurb} <Term id={copy.term} />
        </p>
        {lowConf && copy.lowConfidenceNote && (
          <p className="g-scard-low">
            <Icon name="warning" size={14} /> {copy.lowConfidenceNote}
          </p>
        )}

        {isReplay ? (
          <label className="g-field">
            <span className="g-field-label">Which past crash</span>
            <select className="g-select" value={win} onChange={(e) => setWin(e.target.value)}>
              {(winSpec?.options ?? bundle.history.replay_windows.map((w) => w.id)).map((id) => (
                <option key={id} value={id}>
                  {WINDOW_SHORT[id] ?? bundle.history.replay_windows.find((w) => w.id === id)?.label ?? id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            {hasLevels && (
              <div className="g-pills" role="radiogroup" aria-label={`How strong: ${copy.title}`}>
                {LEVELS.map((lv) => {
                  const cap = intensityCaption(copy.id, levels[lv]);
                  return (
                    <button
                      key={lv}
                      type="button"
                      role="radio"
                      aria-checked={level === lv}
                      className={`g-pill${level === lv ? ' is-on' : ''}`}
                      onClick={() => setLevel(lv)}
                    >
                      <span>{INTENSITY_LABEL[lv]}</span>
                      {cap && <small>{cap}</small>}
                    </button>
                  );
                })}
              </div>
            )}
            {level === 'custom' && <p className="g-scard-note">Your own settings (from Customize).</p>}
            <div className="g-pills is-small" role="radiogroup" aria-label={`Over what time: ${copy.title}`}>
              <Icon name="clock" size={15} />
              {HORIZONS.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={h === x}
                  className={`g-pill${h === x ? ' is-on' : ''}`}
                  onClick={() => {
                    setH(x);
                    if (level === 'custom') setLevel('severe');
                  }}
                >
                  {HORIZON_CHIP[x]}
                </button>
              ))}
              <Term id="horizon" />
            </div>
          </>
        )}

        {sentence && <p className="g-scard-say">{sentence}</p>}
        <Preview r={preview} />

        <div className="g-scard-actions">
          <button
            type="button"
            className="g-btn g-btn-primary"
            onClick={() => {
              commit();
              actions.setView('impact');
            }}
          >
            See who gets hit <Icon name="arrowRight" size={16} />
          </button>
          <button
            type="button"
            className="g-btn g-btn-ghost"
            onClick={() => {
              commit();
              openCustomize();
            }}
          >
            <Icon name="sliders" size={16} /> Customize
          </button>
        </div>
      </div>
    </article>
  );
}

export default function HomeView(props: GuidedProps) {
  const { state } = props;
  const { bundle, params } = state;
  const have = new Set(bundle.presets.map((p) => p.id));
  const cards = SCENARIOS.filter((s) => have.has(s.id));
  const key = paramsKey(params);
  return (
    <div className="g-home">
      <section className="g-hero">
        <p className="g-eyebrow">
          <Icon name="flow" size={16} /> A what-if simulator — every scenario is hypothetical
        </p>
        <h1 className="g-h1" tabIndex={-1} data-autofocus>
          What happens to Indian stocks if the AI boom deflates?
        </h1>
        <p className="g-lead">
          Pick a shock that starts in the US — from Big Tech cutting AI spending to a full <Term id="ai_bubble">AI-bubble</Term> pop. The
          model traces how it reaches {bundle.india.length} Indian listed companies and roughly how far each could fall, using their
          past price behaviour and their business links to US AI.
        </p>
        <HowItReachesIndia n={bundle.india.length} us={bundle.origins.length} />
      </section>

      <div className="g-section-head">
        <StepNum n={1} />
        <div>
          <h2 className="g-h2">Pick a scenario</h2>
          <p className="g-muted">
            Choose how strong and over what time, then press <b>See who gets hit</b>. The small line under each card is a live
            preview.
          </p>
        </div>
      </div>
      {cards.length === 0 ? (
        <Callout tone="error" title="No scenarios in the data bundle">
          The data file has no scenario presets, so there is nothing to simulate.
        </Callout>
      ) : (
        <div className="g-scards">
          {cards.map((c) => (
            <ScenarioCard key={c.id + (params.preset === c.id ? `|${key}` : '')} {...props} copy={c} />
          ))}
        </div>
      )}
    </div>
  );
}
