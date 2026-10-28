// DEV-ONLY harness (UI-B): renders F4 against the real history section the DATA-HISTORY agent
// previewed in .cache/history_preview.json. Never shipped; delete once public/data.json exists.
import { createRoot } from 'react-dom/client';
import '../../../styles/theme.css';
import preview from '../../../../.cache/history_preview.json';
import HistoryPanel from '../../HistoryPanel';
import SourcesPanel from '../../SourcesPanel';

const p = preview as any;
const bundle: any = {
  meta: { as_of: '(preview)', ticker_log: [], data_sources: [], warnings: [], regression_window: null, pre_chatgpt: null, alignment: null },
  settings: {},
  india: [],
  origins: [],
  securities: {},
  presets: [],
  assumptions: [],
  sources: p.sources,
  history: p.history,
  calibration: p.calibration,
};
const noop = () => {};
const actions: any = new Proxy({}, { get: () => noop });
const which = new URLSearchParams(location.search).get('panel') ?? 'F4';
const focus = new URLSearchParams(location.search).get('focus');
const state: any = {
  bundle,
  params: { preset: 'fullpop', horizon: '12M', values: {}, overrides: {}, premiumFloorZero: true },
  result: null,
  mc: null,
  mcRunning: false,
  panel: which,
  selected: null,
  tierFilter: 'ALL',
  historyFocus: focus,
  message: null,
};
createRoot(document.getElementById('root')!).render(which === 'F6' ? <SourcesPanel state={state} actions={actions} /> : <HistoryPanel state={state} actions={actions} />);
