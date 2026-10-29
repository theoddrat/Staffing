// Guided mode shell: hypothetical banner, brand + company search + "How this works" + mode switch,
// the five-step story nav, a scenario bar, the current view, the footer, the tour and the drawer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../styles/guided.css';
import type { GuidedView } from '../panels/types';
import type { ExtState, StoreActions } from '../state/store';
import { paramSpecs } from '../engine';
import HistoryTimeline from './history/HistoryTimeline';
import AccuracyPage from './accuracy/AccuracyPage';
import LearnPage from '../learn/LearnPage';
import { Icon, type IconName } from './icons';
import { ScenarioArt } from './art';
import { GuidedBoundary } from './ui';
import Tour from './Tour';
import SearchBox from './SearchBox';
import HomeView from './views/HomeView';
import ImpactView from './views/ImpactView';
import StockView from './views/StockView';
import FlowView from './views/FlowView';
import CustomizeDrawer from './views/CustomizeDrawer';
import { readPref, writePref } from './storage';
import { HORIZON_WORDS } from './lib/format';
import { headlineItems } from './lib/headline';
import { INTENSITY_LABEL, levelOf, levelsFor } from './lib/intensity';
import { scenarioCopy, WINDOW_SHORT } from './lib/scenarios';

const STEPS: { view: GuidedView; n?: number; label: string; short: string; icon: IconName }[] = [
  { view: 'home', n: 1, label: 'Pick a scenario', short: 'Scenario', icon: 'sliders' },
  { view: 'impact', n: 2, label: 'Who gets hit', short: 'Who’s hit', icon: 'trendDown' },
  { view: 'flow', n: 3, label: 'How it spreads', short: 'Spread', icon: 'flow' },
  { view: 'history', n: 4, label: 'Past crashes', short: 'History', icon: 'clock' },
  { view: 'accuracy', n: 5, label: 'How accurate is it?', short: 'Accuracy', icon: 'target' },
  { view: 'learn', label: 'Learn', short: 'Learn', icon: 'book' },
];

function StepNav({ view, onGo }: { view: GuidedView; onGo(v: GuidedView): void }) {
  const cur = view === 'stock' ? 'impact' : view;
  return (
    <nav className="g-steps" aria-label="Steps">
      <ol>
        {STEPS.map((s) => (
          <li key={s.view}>
            <button type="button" className={`g-step${cur === s.view ? ' is-on' : ''}`} aria-current={cur === s.view ? 'page' : undefined} onClick={() => onGo(s.view)}>
              {s.n ? <span className="g-step-n">{s.n}</span> : <Icon name={s.icon} size={15} />}
              <span className="g-step-long">{s.label}</span>
              <span className="g-step-short">{s.short}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ModeToggle({ onTerminal }: { onTerminal(): void }) {
  return (
    <div className="g-seg g-mode" role="group" aria-label="View">
      <button type="button" className="is-on" aria-pressed="true">
        <Icon name="book" size={15} /> <span>Guided</span>
      </button>
      <button type="button" aria-pressed="false" onClick={onTerminal} title="Switch to the dense terminal view (same scenario)">
        <Icon name="terminal" size={15} /> <span>Terminal</span>
      </button>
    </div>
  );
}

function ScenarioBar({ state, onChange, onCustomize }: { state: ExtState; onChange(): void; onCustomize(): void }) {
  const { bundle, params, result } = state;
  const copy = scenarioCopy(params.preset);
  const specs = useMemo(() => paramSpecs(bundle, params.preset, params.horizon), [bundle, params.preset, params.horizon]);
  const level = useMemo(() => levelOf(levelsFor(bundle, params.preset, params.horizon, specs), params.values, specs), [bundle, params, specs]);
  const isReplay = params.preset === 'replay';
  const win = typeof params.values.window === 'string' ? params.values.window : null;
  const detail = isReplay ? WINDOW_SHORT[win ?? ''] ?? win ?? '' : `${level ? INTENSITY_LABEL[level] : 'Custom'} · ${HORIZON_WORDS[params.horizon]}`;
  const icons = { chips: 'chip', nifty: 'trendDown', india: 'rupee' } as const;
  return (
    <section className="g-scbar" aria-label="Current scenario">
      <div className="g-scbar-art" aria-hidden="true">
        <ScenarioArt art={copy.art} />
      </div>
      <div className="g-scbar-text">
        <p className="g-scbar-title">
          {copy.title} <span className="g-scbar-detail">{detail}</span>
        </p>
        <ul className="g-preview">
          {headlineItems(result).map((i) => (
            <li key={i.id}>
              <Icon name={icons[i.id]} size={14} />
              <span>{i.label}</span>
              <b>{i.value}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="g-scbar-actions">
        <button type="button" className="g-btn g-btn-small" onClick={onCustomize}>
          <Icon name="sliders" size={15} /> Customize
        </button>
        <button type="button" className="g-btn g-btn-small g-btn-ghost" onClick={onChange}>
          Change scenario
        </button>
      </div>
    </section>
  );
}

export default function GuidedApp({ state, actions }: { state: ExtState; actions: StoreActions }) {
  const { bundle, result, view } = state;
  const [tour, setTour] = useState(() => readPref('tour') !== 'done' && view === 'home');
  const [drawer, setDrawer] = useState(false);
  const openCustomize = useCallback(() => setDrawer(true), []);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const closeTour = useCallback(() => {
    writePref('tour', 'done');
    setTour(false);
  }, []);

  // New page: back to the top and move focus to its heading (keyboard + screen-reader users).
  useEffect(() => {
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => {
      const h = document.querySelector<HTMLElement>('.g-main [data-autofocus], .g-main h1, .g-main h2');
      if (h && !tour && document.activeElement?.closest('.g-search') == null) h.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, state.selected]);

  const props = { state, actions, openCustomize };
  let page;
  switch (view) {
    case 'home':
      page = <HomeView {...props} />;
      break;
    case 'impact':
      page = <ImpactView {...props} />;
      break;
    case 'stock':
      page = <StockView {...props} />;
      break;
    case 'flow':
      page = <FlowView {...props} />;
      break;
    case 'history':
      page = <HistoryTimeline state={state} actions={actions} />;
      break;
    case 'accuracy':
      page = <AccuracyPage state={state} actions={actions} />;
      break;
    case 'learn':
      page = <LearnPage state={state} actions={actions} />;
      break;
    default:
      page = <HomeView {...props} />;
  }

  return (
    <div className="g-app">
      <div className="g-banner" role="note">
        <span>
          <Icon name="warning" size={15} /> <b>Hypothetical scenario</b> — model output, not a forecast
        </span>
        {result.lowConfidence && <span className="g-banner-flag">Low confidence: includes the AI-debt channel</span>}
      </div>

      <header className="g-top">
        <button type="button" className="g-brand" onClick={() => actions.setView('home')} aria-label="AI Crash Monitor — back to the start">
          <span className="g-brand-mark" aria-hidden="true">
            <Icon name="trendDown" size={18} />
          </span>
          <span className="g-brand-name">AI Crash Monitor</span>
        </button>
        <SearchBox bundle={bundle} result={result} onPick={(t) => actions.setView('stock', t)} />
        <div className="g-top-actions">
          <button type="button" className="g-btn g-btn-ghost g-btn-small" onClick={() => setTour(true)}>
            <Icon name="help" size={16} /> <span className="g-hide-sm">How this works</span>
          </button>
          <ModeToggle onTerminal={() => actions.setMode('terminal')} />
        </div>
      </header>

      <StepNav view={view} onGo={(v) => actions.setView(v)} />
      {view !== 'home' && <ScenarioBar state={state} onChange={() => actions.setView('home')} onCustomize={openCustomize} />}

      <main id="g-main" className="g-main">
        <GuidedBoundary key={`${view}|${state.selected ?? ''}`} onHome={() => actions.setView('home')} onTerminal={() => actions.setMode('terminal')}>
          {page}
        </GuidedBoundary>
      </main>

      <footer className="g-footer">
        <p>
          <b>Educational model. Not investment advice.</b>
        </p>
        <p className="g-muted">
          All scenarios are hypothetical. Data as of {bundle.meta.as_of} (NSE) and {bundle.meta.as_of_us} (US). Every number that is not
          calculated carries a tag — Sourced, Unverified or Assumption — with a link to where it came from.
        </p>
      </footer>

      {drawer && <CustomizeDrawer state={state} actions={actions} onClose={closeDrawer} />}
      {tour && <Tour bundle={bundle} onClose={closeTour} />}
    </div>
  );
}
