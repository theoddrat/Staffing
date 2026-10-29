// Shared contract between the app shell (UI-A) and every panel (UI-A: F1-F3 + SEC, UI-B: F4-F6).
import type { DataBundle, Tier } from '../types/data';
import type { Horizon, MCResult, ParamValue, PresetId, ScenarioParams, ScenarioResult } from '../types/engine';

export type PanelId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'SEC';

/** V2 guided views (DESIGN §9.5). Terminal mode keeps the F-key panels above. */
export type GuidedView = 'home' | 'impact' | 'stock' | 'flow' | 'history' | 'accuracy' | 'learn';
export type UiMode = 'guided' | 'terminal';

export const PANEL_TITLES: Record<PanelId, string> = {
  F1: 'SHOCK',
  F2: 'INDIA IMPACT',
  F3: 'TRANSMISSION MAP',
  F4: 'HISTORY',
  F5: 'MODEL',
  F6: 'SOURCES',
  SEC: 'SECURITY',
};

export interface AppState {
  bundle: DataBundle;
  params: ScenarioParams;
  result: ScenarioResult;
  mc: MCResult | null; // last Monte Carlo for the current params (null while stale/not run)
  mcRunning: boolean;
  panel: PanelId;
  selected: string | null; // selected ticker (security page, fan chart, rolling betas...)
  tierFilter: Tier | 'ALL';
  historyFocus: string | null; // history case / event id requested via `HIST <ID> <GO>`
  message: string | null; // last command-bar feedback line
  mode?: UiMode; // V2: default 'guided' for first-time users (remembered per browser)
  view?: GuidedView; // V2: current guided view
}

export interface AppActions {
  navigate(panel: PanelId): void;
  setPreset(id: PresetId, horizon?: Horizon): void;
  setHorizon(h: Horizon): void;
  setValue(key: string, value: ParamValue): void;
  setOverride(quantityId: string, value: number | null): void; // null = reset to universe default
  setPremiumFloor(on: boolean): void;
  runMC(fanTicker?: string): void;
  select(ticker: string | null): void;
  setTierFilter(t: Tier | 'ALL'): void;
  setHistoryFocus(id: string | null): void;
  go(command: string): void; // execute a command-bar command, e.g. "CAPEX -30"
  setMode?(mode: UiMode): void; // V2
  setView?(view: GuidedView, ticker?: string | null): void; // V2: e.g. setView('stock', 'NETWEB.NS')
}

export interface PanelProps {
  state: AppState;
  actions: AppActions;
}
