// App shell: loads /data.json (never renders invented numbers), then the terminal: banner, header,
// F-keys, command bar, ticker tape, active panel, status line, footer.
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DataBundle } from './types/data';
import type { PanelId, PanelProps } from './panels/types';
import { useTerminal } from './state/store';
import { contextFromBundle } from './commands/parse';
import { Banner, FunctionKeys, Footer, HeaderBar, HelpOverlay, StatusLine } from './components/Shell';
import CommandBar from './components/CommandBar';
import TickerTape from './components/TickerTape';
import ShockPanel from './panels/ShockPanel';
import ImpactPanel from './panels/ImpactPanel';
import TransmissionPanel from './panels/TransmissionPanel';
import SecurityPanel from './panels/SecurityPanel';
import HistoryPanel from './panels/HistoryPanel';
import ModelPanel from './panels/ModelPanel';
import SourcesPanel from './panels/SourcesPanel';

type Load = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; bundle: DataBundle };

function validateBundle(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'data.json is not an object';
  const d = b as Partial<DataBundle>;
  if (!d.meta || typeof d.meta !== 'object') return 'missing meta';
  if (!Array.isArray(d.india)) return 'missing india[]';
  if (!Array.isArray(d.origins)) return 'missing origins[]';
  if (!Array.isArray(d.presets) || !d.presets.length) return 'missing presets[]';
  if (!d.securities || typeof d.securities !== 'object') return 'missing securities{}';
  if (!d.history || typeof d.history !== 'object') return 'missing history{}';
  return null;
}

const PANELS: Record<PanelId, (p: PanelProps) => ReactNode> = {
  F1: (p) => <ShockPanel {...p} />,
  F2: (p) => <ImpactPanel {...p} />,
  F3: (p) => <TransmissionPanel {...p} />,
  F4: (p) => <HistoryPanel {...p} />,
  F5: (p) => <ModelPanel {...p} />,
  F6: (p) => <SourcesPanel {...p} />,
  SEC: (p) => <SecurityPanel {...p} />,
};

class PanelBoundary extends Component<{ panel: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? `${e.message}` : String(e) };
  }
  componentDidUpdate(prev: { panel: string }) {
    if (prev.panel !== this.props.panel && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="panel">
          <div className="panel-header down">PANEL ERROR — {this.props.panel}</div>
          <div className="panel-body">
            <span className="down">{this.state.error}</span>
            <p className="muted">The rest of the terminal keeps working. Switch panels with F1–F6.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Splash({ load }: { load: Exclude<Load, { status: 'ok' }> }) {
  return (
    <div className="app">
      <Banner lowConfidence={false} />
      <div className="header-bar">
        <span className="app-title">AI CRASH MONITOR</span>
      </div>
      <main className="main splash">
        {load.status === 'loading' ? (
          <div className="panel">
            <div className="panel-header">LOADING</div>
            <div className="panel-body">
              FETCHING <span className="white">/data.json</span> <span className="blink-soft">▌</span>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header down">DATA NOT AVAILABLE</div>
            <div className="panel-body">
              <p className="down">{load.error}</p>
              <p>
                The terminal only renders numbers from the generated data bundle. Build it first:
              </p>
              <pre className="white">python build_data.py && npm run dev</pre>
              <p className="muted">No mock or placeholder figures are shown in place of missing data.</p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Terminal({ bundle }: { bundle: DataBundle }) {
  const { state, actions } = useTerminal(bundle);
  const ctx = useMemo(() => contextFromBundle(bundle), [bundle]);
  const [focusKey, setFocusKey] = useState(0);

  // Keyboard: F1–F6 switch panels (preventDefault stops browser help/reload), Esc = back / close help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^F[1-6]$/.test(e.key)) {
        e.preventDefault();
        actions.navigate(e.key as PanelId);
        return;
      }
      if (e.key === 'Escape') {
        if (state.helpOpen) actions.openHelp(false);
        else if (!(e.target instanceof HTMLInputElement)) actions.back();
        return;
      }
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      if (!inField && (e.key === '/' || e.key === '`')) {
        e.preventDefault();
        setFocusKey((k) => k + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, state.helpOpen]);

  // Deep links: ?cmd=POP%2012M;NVDA  and  #F2 (applied once on mount; guarded for StrictMode).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    deepLinked.current = true;
    try {
      const q = new URLSearchParams(window.location.search);
      const cmds = q.getAll('cmd').flatMap((c) => c.split(';')).map((c) => c.trim()).filter(Boolean);
      for (const c of cmds) actions.go(c);
      const h = window.location.hash.replace('#', '').toUpperCase();
      if (/^F[1-6]$/.test(h) || h === 'SEC') actions.navigate(h as PanelId);
    } catch {
      /* ignore malformed URLs */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${state.panel}`);
    } catch {
      /* ignore */
    }
  }, [state.panel]);

  if (!state.result) {
    return (
      <Splash
        load={{ status: 'error', error: `Scenario engine failed on the default preset: ${state.resultError ?? 'unknown error'}` }}
      />
    );
  }

  const props: PanelProps = { state, actions };
  return (
    <div className="app">
      <Banner lowConfidence={state.result.lowConfidence} />
      <HeaderBar bundle={bundle} result={state.result} />
      <FunctionKeys panel={state.panel} onNav={actions.navigate} />
      <CommandBar ctx={ctx} onGo={actions.go} focusKey={focusKey} />
      <TickerTape bundle={bundle} onPick={(t) => actions.go(bundle.india.find((x) => x.ticker === t)?.display ?? t)} />
      <main className="main">
        <PanelBoundary panel={state.panel}>{PANELS[state.panel](props)}</PanelBoundary>
      </main>
      <StatusLine
        message={state.message}
        kind={state.messageKind}
        mcRunning={state.mcRunning}
        mcStale={state.mcStale}
        hasMc={!!state.lastMc}
        mcError={state.mcError}
        resultError={state.resultError}
        runs={state.lastMc?.runs ?? null}
      />
      <Footer />
      {state.helpOpen && <HelpOverlay onClose={() => actions.openHelp(false)} />}
    </div>
  );
}

export default function App() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    // Relative to the page (vite base './'), so the app also works when hosted under a sub-path.
    fetch(`${import.meta.env.BASE_URL}data.json`, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /data.json → HTTP ${r.status}`);
        const ct = r.headers.get('content-type') ?? '';
        if (!ct.includes('json')) throw new Error('public/data.json not found (the server returned a web page instead of JSON).');
        return r.json();
      })
      .then((b: unknown) => {
        const err = validateBundle(b);
        if (err) throw new Error(`data.json does not match the schema: ${err}`);
        if (alive) setLoad({ status: 'ok', bundle: b as DataBundle });
      })
      .catch((e) => alive && setLoad({ status: 'error', error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, []);
  if (load.status !== 'ok') return <Splash load={load} />;
  return <Terminal bundle={load.bundle} />;
}
