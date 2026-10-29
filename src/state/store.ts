// App store: useReducer + derived scenario result. Implements the AppActions contract
// (src/panels/types.ts). runScenario is recomputed synchronously on every parameter change;
// the Monte Carlo runs in a worker, debounced, and is merged in with withRanges when fresh.
// One store serves both UIs (guided and terminal), so switching modes keeps the scenario.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { DataBundle, Tier } from '../types/data';
import type { Horizon, MCResult, ParamValue, PresetId, ScenarioParams, ScenarioResult } from '../types/engine';
import type { AppActions, AppState, GuidedView, PanelId, UiMode } from '../panels/types';
import type { GlossaryId } from '../learn/ids';
import { DEFAULT_MC_RUNS, DEFAULT_MC_SEED, defaultParams, horizonForWindow, runScenario, withHorizon, withRanges } from '../engine';
import { contextFromBundle, parseCommand, type ParseContext } from '../commands/parse';
import { panelForView, parseHash, viewForPanel, type Route } from '../guided/router';
import { readPref, writePref } from '../guided/storage';
import { McClient } from './mcClient';
import { useRouteSync } from './routeSync';

export const MC_RUNS = DEFAULT_MC_RUNS;
const MC_DEBOUNCE_MS = 400;
const INITIAL_PRESET: PresetId = 'fullpop';
const INITIAL_HORIZON: Horizon = '12M';

/** Extra (optional) state used by UI-A panels on top of the AppState contract. */
export interface ExtState extends AppState {
  lastMc: MCResult | null; // last completed MC (may be stale)
  mcStale: boolean;
  mcError: string | null;
  resultError: string | null;
  messageKind: 'info' | 'error';
  helpOpen: boolean;
  canGoBack: boolean;
  mode: UiMode;
  view: GuidedView;
  learnTerm: GlossaryId | null; // glossary entry the Learn page should open at
}

/** Everything the store can do: the AppActions contract plus shell and guided-mode extras. */
export interface StoreActions extends AppActions {
  back(): void;
  openHelp(open: boolean): void;
  setMode(mode: UiMode): void;
  setView(view: GuidedView, ticker?: string | null): void;
  openLearn(id: GlossaryId): void;
  /** Switch preset + horizon and set several values in one step (the preset's defaults fill the rest). */
  applyScenario(preset: PresetId, horizon?: Horizon, values?: Record<string, ParamValue>): void;
  /** Set several parameter values of the current preset at once. */
  setValues(values: Record<string, ParamValue>): void;
}

interface StoreState {
  params: ScenarioParams;
  panel: PanelId;
  back: PanelId[];
  selected: string | null;
  tierFilter: Tier | 'ALL';
  historyFocus: string | null;
  message: string | null;
  messageKind: 'info' | 'error';
  helpOpen: boolean;
  mc: { result: MCResult; key: string } | null;
  mcRunning: boolean;
  mcError: string | null;
  mode: UiMode;
  view: GuidedView;
  learnTerm: GlossaryId | null;
}

type Action =
  | { type: 'params'; params: ScenarioParams }
  | { type: 'navigate'; panel: PanelId }
  | { type: 'back' }
  | { type: 'select'; ticker: string | null }
  | { type: 'tier'; tier: Tier | 'ALL' }
  | { type: 'hist'; id: string | null }
  | { type: 'message'; text: string | null; kind?: 'info' | 'error' }
  | { type: 'help'; open: boolean }
  | { type: 'mcStart' }
  | { type: 'mcDone'; result: MCResult; key: string }
  | { type: 'mcFail'; error: string }
  | { type: 'route'; route: Route }
  | { type: 'view'; view: GuidedView; ticker?: string | null; term?: GlossaryId | null };

function reducer(s: StoreState, a: Action): StoreState {
  switch (a.type) {
    case 'params':
      return { ...s, params: a.params };
    case 'navigate':
      if (a.panel === s.panel) return s;
      return { ...s, panel: a.panel, back: [...s.back.slice(-19), s.panel] };
    case 'back': {
      if (!s.back.length) return s;
      const back = s.back.slice(0, -1);
      return { ...s, panel: s.back[s.back.length - 1], back };
    }
    case 'select':
      return { ...s, selected: a.ticker };
    case 'tier':
      return { ...s, tierFilter: a.tier };
    case 'hist':
      return { ...s, historyFocus: a.id };
    case 'message':
      return { ...s, message: a.text, messageKind: a.kind ?? 'info' };
    case 'help':
      return { ...s, helpOpen: a.open };
    case 'mcStart':
      return { ...s, mcRunning: true, mcError: null };
    case 'mcDone':
      return { ...s, mcRunning: false, mc: { result: a.result, key: a.key }, mcError: null };
    case 'mcFail':
      return { ...s, mcRunning: false, mcError: a.error };
    case 'route': {
      const r = a.route;
      if (r.mode === 'terminal') {
        if (s.mode === 'terminal' && s.panel === r.panel) return s;
        const back = s.panel !== r.panel ? [...s.back.slice(-19), s.panel] : s.back;
        return { ...s, mode: 'terminal', panel: r.panel, back };
      }
      const selected = r.ticker ?? s.selected;
      const learnTerm = r.view === 'learn' ? r.term : s.learnTerm;
      if (s.mode === 'guided' && s.view === r.view && s.selected === selected && s.learnTerm === learnTerm) return s;
      return { ...s, mode: 'guided', view: r.view, selected, learnTerm };
    }
    case 'view': {
      const selected = a.ticker ?? s.selected;
      const learnTerm = a.view === 'learn' ? a.term ?? null : s.learnTerm;
      if (s.view === a.view && s.selected === selected && s.learnTerm === learnTerm) return s;
      return { ...s, view: a.view, selected, learnTerm };
    }
    default:
      return s;
  }
}

export function paramsKey(p: ScenarioParams): string {
  const sortObj = (o: Record<string, unknown>) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${JSON.stringify(o[k])}`)
      .join('&');
  return `${p.preset}|${p.horizon}|${sortObj(p.values)}|${sortObj(p.overrides)}|${p.premiumFloorZero ? 1 : 0}`;
}

function freshParams(bundle: DataBundle, preset: PresetId, horizon: Horizon | undefined, keep?: ScenarioParams): ScenarioParams {
  // horizon undefined -> the preset's own default (fullpop 12M, replay = window length, others 1M)
  const p = defaultParams(bundle, preset, horizon);
  return {
    ...p,
    horizon: p.horizon ?? horizon ?? '1M',
    overrides: keep ? { ...keep.overrides } : { ...(p.overrides ?? {}) },
    premiumFloorZero: keep ? keep.premiumFloorZero : p.premiumFloorZero ?? true,
  };
}

function safeRun(bundle: DataBundle, params: ScenarioParams): { result: ScenarioResult | null; error: string | null } {
  try {
    return { result: runScenario(bundle, params), error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function isIndia(bundle: DataBundle, t: string | null): boolean {
  return !!t && bundle.india.some((x) => x.ticker === t);
}

/**
 * Where the app opens: the URL hash wins (#F2 → terminal, #impact / #stock-NETWEB → guided),
 * then a terminal deep link (?cmd=…), then the mode remembered in this browser, else guided.
 */
export function initialRoute(bundle: DataBundle): Pick<StoreState, 'mode' | 'view' | 'panel' | 'selected' | 'learnTerm'> {
  let hash = '';
  let search = '';
  try {
    hash = window.location.hash;
    search = window.location.search;
  } catch {
    /* no window (tests) */
  }
  const r = parseHash(hash, bundle);
  if (r?.mode === 'terminal') return { mode: 'terminal', view: viewForPanel(r.panel, null, bundle), panel: r.panel, selected: null, learnTerm: null };
  if (r?.mode === 'guided') return { mode: 'guided', view: r.view, panel: panelForView(r.view, r.ticker), selected: r.ticker, learnTerm: r.term };
  const mode: UiMode = /[?&]cmd=/.test(search) || readPref('mode') === 'terminal' ? 'terminal' : 'guided';
  return { mode, view: 'home', panel: 'F2', selected: null, learnTerm: null };
}

export function useTerminal(bundle: DataBundle): { state: ExtState; actions: StoreActions } {
  const init = (): StoreState => {
    const hasFullpop = bundle.presets.some((p) => p.id === INITIAL_PRESET);
    const preset = hasFullpop ? INITIAL_PRESET : bundle.presets[0]?.id ?? 'capex';
    const route = initialRoute(bundle);
    return {
      params: freshParams(bundle, preset, INITIAL_HORIZON),
      ...route,
      back: [],
      tierFilter: 'ALL',
      historyFocus: null,
      message: null,
      messageKind: 'info',
      helpOpen: false,
      mc: null,
      mcRunning: false,
      mcError: null,
    };
  };
  const [s, dispatch] = useReducer(reducer, undefined, init);
  const ctx: ParseContext = useMemo(() => contextFromBundle(bundle), [bundle]);

  // ---- derived scenario result (synchronous) ----
  const lastGood = useRef<ScenarioResult | null>(null);
  const run = useMemo(() => safeRun(bundle, s.params), [bundle, s.params]);
  if (run.result) lastGood.current = run.result;
  const key = useMemo(() => paramsKey(s.params), [s.params]);
  const mcFresh = s.mc && s.mc.key === key ? s.mc.result : null;
  const baseResult = run.result ?? lastGood.current;
  const result = useMemo(() => {
    if (!baseResult) return null;
    if (!mcFresh) return baseResult;
    try {
      return withRanges(baseResult, mcFresh);
    } catch {
      return baseResult;
    }
  }, [baseResult, mcFresh]);

  // ---- Monte Carlo (worker, debounced) ----
  const client = useRef<McClient | null>(null);
  if (!client.current) client.current = new McClient();
  useEffect(() => () => client.current?.dispose(), []);
  const paramsRef = useRef(s.params);
  paramsRef.current = s.params;
  const selectedRef = useRef(s.selected);
  selectedRef.current = s.selected;
  const resultRef = useRef(result);
  resultRef.current = result;

  const runMC = useCallback(
    (fanTicker?: string) => {
      const params = paramsRef.current;
      const k = paramsKey(params);
      const sel = fanTicker ?? selectedRef.current;
      const fan = isIndia(bundle, sel) ? sel! : resultRef.current?.india[0]?.ticker;
      dispatch({ type: 'mcStart' });
      client.current!
        .run(bundle, params, { runs: MC_RUNS, seed: DEFAULT_MC_SEED, fanTicker: fan })
        .then((r) => dispatch({ type: 'mcDone', result: r, key: k }))
        .catch((e) => {
          if (e instanceof Error && e.message === 'superseded') return;
          dispatch({ type: 'mcFail', error: e instanceof Error ? e.message : String(e) });
        });
    },
    [bundle],
  );

  useEffect(() => {
    if (!run.result) return;
    const t = setTimeout(() => runMC(), MC_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, run.result, runMC]);

  // Re-run for a new fan ticker when the selection changes to an India stock not covered by the fan.
  const lastFanRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!isIndia(bundle, s.selected)) return;
    if (s.mc?.result.fan?.ticker === s.selected) return;
    if (lastFanRequest.current === `${s.selected}|${key}`) return;
    const t = setTimeout(() => {
      lastFanRequest.current = `${s.selected}|${key}`;
      runMC(s.selected!);
    }, MC_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [s.selected, bundle, runMC, s.mc, key]);

  // ---- actions ----
  const sRef = useRef(s);
  sRef.current = s;
  const setParams = useCallback((p: ScenarioParams) => dispatch({ type: 'params', params: p }), []);
  const onRoute = useCallback((route: Route) => dispatch({ type: 'route', route }), []);
  useRouteSync(bundle, { mode: s.mode, view: s.view, selected: s.selected, learnTerm: s.learnTerm, panel: s.panel }, onRoute);

  const actions = useMemo(() => {
    const a: StoreActions = {
      navigate: (panel) => dispatch({ type: 'navigate', panel }),
      back: () => dispatch({ type: 'back' }),
      openHelp: (open) => dispatch({ type: 'help', open }),
      setPreset: (id: PresetId, horizon?: Horizon) => {
        const cur = paramsRef.current;
        setParams(freshParams(bundle, id, horizon, cur));
      },
      setHorizon: (h: Horizon) => setParams(withHorizon(bundle, paramsRef.current, h)),
      setValue: (k: string, v: ParamValue) => {
        const cur = paramsRef.current;
        const next = { ...cur, values: { ...cur.values, [k]: v } };
        // A replay window implies its own horizon (MC residuals accumulate over the window length).
        if (cur.preset === 'replay' && k === 'window' && typeof v === 'string') next.horizon = horizonForWindow(bundle, v);
        setParams(next);
      },
      setOverride: (id: string, v: number | null) => {
        const cur = paramsRef.current;
        const overrides = { ...cur.overrides };
        if (v == null || !Number.isFinite(v)) delete overrides[id];
        else overrides[id] = v;
        setParams({ ...cur, overrides });
      },
      setPremiumFloor: (on: boolean) => setParams({ ...paramsRef.current, premiumFloorZero: on }),
      setMode: (mode: UiMode) => {
        writePref('mode', mode);
        const cur = sRef.current;
        if (mode === 'terminal') dispatch({ type: 'route', route: { mode: 'terminal', panel: panelForView(cur.view, cur.selected) } });
        else dispatch({ type: 'route', route: { mode: 'guided', view: viewForPanel(cur.panel, cur.selected, bundle), ticker: null, term: null } });
      },
      setView: (view: GuidedView, ticker?: string | null) => dispatch({ type: 'view', view, ticker: ticker ?? null }),
      openLearn: (id: GlossaryId) => dispatch({ type: 'route', route: { mode: 'guided', view: 'learn', ticker: null, term: id } }),
      applyScenario: (preset: PresetId, horizon?: Horizon, values?: Record<string, ParamValue>) => {
        const cur = paramsRef.current;
        const win = typeof values?.window === 'string' ? values.window : null;
        const h = preset === 'replay' && win ? horizonForWindow(bundle, win) : horizon;
        const p = freshParams(bundle, preset, h, cur);
        setParams({ ...p, values: { ...p.values, ...(values ?? {}) } });
      },
      setValues: (values: Record<string, ParamValue>) => {
        const cur = paramsRef.current;
        const next = { ...cur, values: { ...cur.values, ...values } };
        if (cur.preset === 'replay' && typeof values.window === 'string') next.horizon = horizonForWindow(bundle, values.window);
        setParams(next);
      },
      runMC: (fan?: string) => runMC(fan),
      select: (t) => dispatch({ type: 'select', ticker: t }),
      setTierFilter: (t) => dispatch({ type: 'tier', tier: t }),
      setHistoryFocus: (id) => dispatch({ type: 'hist', id }),
      go: (command: string) => {
        const c = parseCommand(command, ctx);
        const msg = (text: string, kind: 'info' | 'error' = 'info') => dispatch({ type: 'message', text, kind });
        switch (c.kind) {
          case 'error':
            msg(c.message, 'error');
            return;
          case 'panel':
            dispatch({ type: 'navigate', panel: c.panel });
            msg(`${c.panel}`);
            return;
          case 'help':
            dispatch({ type: 'help', open: true });
            return;
          case 'mc':
            runMC();
            msg(`MONTE CARLO: ${MC_RUNS.toLocaleString()} RUNS QUEUED`);
            return;
          case 'reset': {
            const cur = paramsRef.current;
            setParams(freshParams(bundle, cur.preset, cur.horizon, { ...cur, overrides: {} }));
            msg(`RESET ${cur.preset.toUpperCase()} TO UNIVERSE DEFAULTS`);
            return;
          }
          case 'security':
            dispatch({ type: 'select', ticker: c.ticker });
            dispatch({ type: 'navigate', panel: 'SEC' });
            msg(c.note ?? `${c.ticker}`);
            return;
          case 'tier':
            dispatch({ type: 'tier', tier: c.tier });
            dispatch({ type: 'navigate', panel: 'F2' });
            msg(`INDIA IMPACT — TIER ${c.tier}`);
            return;
          case 'hist':
            dispatch({ type: 'hist', id: c.id });
            dispatch({ type: 'navigate', panel: 'F4' });
            msg(c.id ? `HISTORY — ${c.id.toUpperCase()}` : 'HISTORY');
            return;
          case 'scenario': {
            if (!bundle.presets.some((p) => p.id === c.preset)) {
              msg(`PRESET ${c.preset} NOT IN DATA BUNDLE`, 'error');
              return;
            }
            const cur = paramsRef.current;
            const win = typeof c.values.window === 'string' ? c.values.window : null;
            const h = c.horizon ?? (c.preset === 'replay' && win ? horizonForWindow(bundle, win) : undefined);
            const p = freshParams(bundle, c.preset, h, cur);
            setParams({ ...p, values: { ...p.values, ...c.values } });
            dispatch({ type: 'navigate', panel: ['F1', 'F2', 'F3'].includes(sRef.current.panel) ? sRef.current.panel : 'F2' });
            msg(c.label);
            return;
          }
        }
      },
    };
    return a;
  }, [bundle, ctx, runMC, setParams]);

  const state: ExtState = {
    bundle,
    params: s.params,
    result: result as ScenarioResult,
    mc: mcFresh,
    mcRunning: s.mcRunning,
    panel: s.panel,
    selected: s.selected,
    tierFilter: s.tierFilter,
    historyFocus: s.historyFocus,
    message: s.message,
    lastMc: s.mc?.result ?? null,
    mcStale: !!s.mc && s.mc.key !== key,
    mcError: s.mcError,
    resultError: run.error,
    messageKind: s.messageKind,
    helpOpen: s.helpOpen,
    canGoBack: s.back.length > 0,
    mode: s.mode,
    view: s.view,
    learnTerm: s.learnTerm,
  };
  return { state, actions };
}
