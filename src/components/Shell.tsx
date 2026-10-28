// Terminal chrome: hypothetical banner, header, function keys, status line, footer, help overlay.
import type { DataBundle } from '../types/data';
import type { ScenarioResult } from '../types/engine';
import { PANEL_TITLES, type PanelId } from '../panels/types';
import { COMMAND_HELP } from '../commands/parse';

export function Banner({ lowConfidence }: { lowConfidence: boolean }) {
  return (
    <div className="hypo-banner" role="alert">
      <span className="hypo-blink">■</span> HYPOTHETICAL SCENARIO — MODEL OUTPUT, NOT A FORECAST
      {lowConfidence && <span className="lowconf-flag">LOW-CONFIDENCE SCENARIO (AI CREDIT CHANNEL)</span>}
    </div>
  );
}

export function HeaderBar({ bundle, result }: { bundle: DataBundle; result: ScenarioResult | null }) {
  const m = bundle.meta;
  const sources = m.data_sources.map((d) => d.name).join(' · ');
  return (
    <div className="header-bar">
      <span className="app-title">{m.app || 'AI CRASH MONITOR'}</span>
      <span className="hdr-item">
        AS OF <b className="white">{m.as_of}</b> (NSE) · <b className="white">{m.as_of_us}</b> (US)
      </span>
      <span className="hdr-item">
        USD/INR <b className="white">{Number.isFinite(m.usd_inr) ? m.usd_inr.toFixed(2) : '—'}</b>
      </span>
      {result && (
        <span className="hdr-item">
          SCENARIO <b className="white">{result.preset.num}. {result.preset.label.toUpperCase()}</b> · {result.params.horizon}
        </span>
      )}
      <span className="spacer" />
      <span className="hdr-item muted" title={m.data_sources.map((d) => `${d.name}: ${d.url} — ${d.note}`).join('\n')}>
        DATA: {sources || '—'} · BUILT {m.built_at?.slice(0, 16).replace('T', ' ')}
      </span>
    </div>
  );
}

const KEYS: PanelId[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

export function FunctionKeys({ panel, onNav }: { panel: PanelId; onNav: (p: PanelId) => void }) {
  return (
    <nav className="fkeys">
      {KEYS.map((k) => (
        <button key={k} className={`fkey ${panel === k ? 'active' : ''}`} onClick={() => onNav(k)} title={`${k} ${PANEL_TITLES[k]}`}>
          <span className="fkey-k">{k}</span> {PANEL_TITLES[k]}
        </button>
      ))}
      {panel === 'SEC' && (
        <span className="fkey active sec-tab">
          <span className="fkey-k">SEC</span> {PANEL_TITLES.SEC}
        </span>
      )}
    </nav>
  );
}

export function StatusLine({
  message,
  kind,
  mcRunning,
  mcStale,
  hasMc,
  mcError,
  resultError,
  runs,
}: {
  message: string | null;
  kind: 'info' | 'error';
  mcRunning: boolean;
  mcStale: boolean;
  hasMc: boolean;
  mcError: string | null;
  resultError: string | null;
  runs: number | null;
}) {
  let mc = 'MC: —';
  if (mcRunning) mc = 'MC: RUNNING…';
  else if (mcError) mc = `MC ERROR: ${mcError}`;
  else if (hasMc && !mcStale) mc = `MC: ${runs?.toLocaleString() ?? ''} RUNS ✓`;
  else if (hasMc && mcStale) mc = 'MC: STALE (RECOMPUTING SOON)';
  return (
    <div className="status-line">
      <span className={kind === 'error' ? 'down' : 'white'}>{message ?? 'READY — TYPE A COMMAND (HELP <GO>)'}</span>
      {resultError && <span className="down"> · ENGINE: {resultError}</span>}
      <span className="spacer" />
      <span className={mcRunning ? 'amber blink-soft' : mcStale ? 'muted' : 'cyan'}>{mc}</span>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <span>Educational model. Not investment advice.</span>
      <span className="muted">
        All scenarios are hypothetical. Non-computed figures carry SRC / UNVERIFIED / USER ASSUMPTION tags — see F6 SOURCES.
      </span>
    </footer>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-box panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          COMMANDS <span className="spacer" />
          <button className="btn" onClick={onClose}>
            CLOSE [ESC]
          </button>
        </div>
        <div className="panel-body">
          <table className="tbl">
            <tbody>
              {COMMAND_HELP.map((c) => (
                <tr key={c.cmd}>
                  <td className="lbl">{c.cmd}</td>
                  <td>{c.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Keys: F1–F6 switch panels · Esc goes back · ↑/↓ recall command history · Tab accepts the first suggestion.
          </p>
        </div>
      </div>
    </div>
  );
}
