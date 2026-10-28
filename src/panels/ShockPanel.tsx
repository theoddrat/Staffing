// F1 SHOCK — preset picker, horizon, parameter sliders (live), factor moves, origin valuation waterfall.
import { useMemo, useState } from 'react';
import type { PanelProps } from './types';
import type { Horizon, OriginResult } from '../types/engine';
import ParamControl from '../components/ParamControl';
import { StatusBadge } from '../components/StatusBadge';
import { crore, isNum, num, pct, signClass, spct, usd } from '../lib/format';
import type { ExtState } from '../state/store';

const HORIZONS: Horizon[] = ['1D', '1M', '12M'];
type SortKey = 'mcap' | 'move' | 'e' | 'd' | 'ticker';

function FactorBox({ state }: PanelProps) {
  const f = state.result.factors;
  const mc = state.mc ?? (state as ExtState).lastMc;
  const stale = !state.mc && !!(state as ExtState).lastMc;
  const rows: { k: string; v: string; cls: string; note?: string; mcp?: { p5: number; p50: number; p95: number } }[] = [
    { k: 'AI BASKET (ALL ORIGINS)', v: spct(f.ai_basket), cls: signClass(f.ai_basket) },
    { k: 'CHIP BASKET', v: spct(f.chip_basket), cls: signClass(f.chip_basket) },
    { k: 'SOX (PHLX SEMIS)', v: spct(f.SOX), cls: signClass(f.SOX), mcp: mc?.factors.SOX },
    { k: 'NDX (NASDAQ-100)', v: spct(f.NDX), cls: signClass(f.NDX), mcp: mc?.factors.NDX },
    { k: 'NIFTY 50 (IMPLIED)', v: spct(f.NIFTY), cls: signClass(f.NIFTY), mcp: mc?.factors.NIFTY },
    {
      k: 'INR DEPRECIATION f',
      v: pct(f.inr_depr),
      cls: f.inr_depr > 0 ? 'down' : 'flat',
      note: state.params.values.f_override == null ? 'AUTO = β(INR,NDX)·x_NDX' : 'USER OVERRIDE',
    },
    { k: 'US TECH REVENUE SHOCK R_tech', v: pct(f.tech_revenue_shock), cls: f.tech_revenue_shock > 0 ? 'down' : 'flat' },
    { k: 'HYPERSCALER CAPEX CUT ($)', v: isNum(f.capex_cut_usd) ? usd(f.capex_cut_usd) : '—', cls: 'white' },
    { k: 'CAPEX ABSORBED BY MODELLED SUPPLIERS', v: isNum(f.capex_absorbed_share) ? pct(f.capex_absorbed_share) : '—', cls: 'white' },
  ];
  return (
    <div className="panel">
      <div className="panel-header">
        FACTOR MOVES <span className="spacer" />
        {mc && <span className={stale ? 'muted' : 'cyan'}>MC P5 / P50 / P95{stale ? ' (STALE)' : ''}</span>}
      </div>
      <table className="tbl">
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="lbl">{r.k}</td>
              <td className={`num ${r.cls}`}>{r.v}</td>
              <td className={`num ${stale ? 'muted' : ''}`}>
                {r.mcp ? `${spct(r.mcp.p5)} / ${spct(r.mcp.p50)} / ${spct(r.mcp.p95)}` : r.note ? <span className="muted">{r.note}</span> : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OriginTable({ state, actions }: PanelProps) {
  const [sort, setSort] = useState<SortKey>('mcap');
  const rows = useMemo(() => {
    const r = [...state.result.origins];
    const key = (o: OriginResult): number | string => {
      switch (sort) {
        case 'ticker':
          return o.ticker;
        case 'move':
          return o.move;
        case 'e':
          return -o.e;
        case 'd':
          return -o.d;
        default:
          return o.mcap_change_usd ?? 0;
      }
    };
    r.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return typeof ka === 'string' ? ka.localeCompare(kb as string) : (ka as number) - (kb as number);
    });
    return r;
  }, [state.result.origins, sort]);
  const th = (k: SortKey, label: string, title?: string) => (
    <th className={`sortable ${sort === k ? 'sorted' : ''}`} onClick={() => setSort(k)} title={title}>
      {label}
    </th>
  );
  const totalUsd = state.result.totals.origin_mcap_change_usd;
  return (
    <div className="panel">
      <div className="panel-header">
        LAYER 1 — ORIGIN VALUATION WATERFALL (PRICE = P/E × EPS; MOVE = (1−e)(1−d) − 1)
        <span className="spacer" />
        <span className={signClass(totalUsd)}>Σ ΔMCAP {usd(totalUsd)}</span>
      </div>
      <div className="scroll origin-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {th('ticker', 'TICKER')}
              <th>GROUP</th>
              <th className="num">PRICE</th>
              <th className="num">P/E</th>
              <th className="num" title="Revenue hit (fraction of revenue lost)">REV HIT</th>
              {th('e', 'EPS CUT e')}
              <th className="num" title="Price after the EPS cut at unchanged P/E: P/E0 × EPS0 × (1−e)">AFTER EPS</th>
              {th('d', 'DE-RATE d')}
              <th className="num">NEW PRICE</th>
              {th('move', 'MOVE')}
              <th className="num">P/E NEW</th>
              {th('mcap', 'ΔMCAP $')}
              <th className="num">ΔMCAP ₹ CR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr
                key={o.ticker}
                className={state.selected === o.ticker ? 'sel' : ''}
                onClick={() => actions.select(o.ticker)}
                onDoubleClick={() => actions.go(o.ticker)}
                title={o.drivers.join('\n') || 'no direct shock on this name'}
              >
                <td className="lbl">{o.ticker}</td>
                <td className="muted">{o.group}</td>
                <td className="num">{num(o.price0, 2)}</td>
                <td className="num">{isNum(o.pe0) ? `${o.pe0.toFixed(1)}x` : '—'}</td>
                <td className="num">{o.revenue_hit ? pct(o.revenue_hit) : '—'}</td>
                <td className="num">{o.e ? pct(o.e) : '—'}</td>
                <td className="num">{num(o.price_after_eps, 2)}</td>
                <td className="num">{o.d ? pct(o.d) : '—'}</td>
                <td className="num white">{num(o.price_new, 2)}</td>
                <td className={`num ${signClass(o.move)}`}>
                  {spct(o.move)}
                  {o.move_sympathy !== 0 && (
                    <span className="muted" title="of which sympathy / contagion">
                      {' '}
                      ({spct(o.move_sympathy)})
                    </span>
                  )}
                </td>
                <td className="num">{isNum(o.pe_new) ? `${o.pe_new.toFixed(1)}x` : '—'}</td>
                <td className={`num ${signClass(o.mcap_change_usd)}`}>{usd(o.mcap_change_usd)}</td>
                <td className={`num ${signClass(o.mcap_change_inr_cr)}`}>{crore(o.mcap_change_inr_cr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot muted">
        Hover a row for the driver math · double-click for the security page. P/E basis: TTM reported EPS (Yahoo earnings
        calendar) — see F5 MODEL.
      </div>
    </div>
  );
}

export default function ShockPanel(props: PanelProps) {
  const { state, actions } = props;
  const { bundle, params, result } = state;
  const preset = result.preset;
  return (
    <div className="shock-panel">
      <div className="panel">
        <div className="panel-header">
          F1 SHOCK — PRESET <span className="spacer" />
          {result.lowConfidence && <span className="down">LOW CONFIDENCE</span>}
        </div>
        <div className="preset-row">
          {bundle.presets.map((p) => (
            <button
              key={p.id}
              className={`btn preset-btn ${p.id === params.preset ? 'active' : ''}`}
              onClick={() => actions.setPreset(p.id)}
              title={p.description}
            >
              {p.num}. {p.label}
              {p.low_confidence ? ' *' : ''}
            </button>
          ))}
        </div>
        <div className="preset-desc">
          <span className="white">{preset.description}</span>
          {preset.low_confidence && <span className="down"> · * LOW-CONFIDENCE CHANNEL</span>}
        </div>
      </div>

      <div className="grid-2 shock-grid">
        <div className="panel">
          <div className="panel-header">
            PARAMETERS — LIVE <span className="spacer" />
            HORIZON
            {HORIZONS.map((h) => (
              <button key={h} className={`btn btn-xs ${params.horizon === h ? 'active' : ''}`} onClick={() => actions.setHorizon(h)}>
                {h}
              </button>
            ))}
          </div>
          <div className="panel-body params">
            {preset.params.map((spec) => (
              <ParamControl
                key={spec.key}
                spec={spec}
                value={params.values[spec.key] === undefined ? spec.value : params.values[spec.key]}
                preset={preset}
                horizon={params.horizon}
                bundle={bundle}
                onChange={(v) => actions.setValue(spec.key, v)}
              />
            ))}
            <div className="param-row">
              <span className="param-label">
                AI-PREMIUM UNWIND FLOOR AT 0
                <StatusBadge status="USER_ASSUMPTION" title="When ON, stocks trading below their pre-ChatGPT P/E are not re-rated upward" />
              </span>
              <button className={`btn ${params.premiumFloorZero ? 'active' : ''}`} onClick={() => actions.setPremiumFloor(!params.premiumFloorZero)}>
                {params.premiumFloorZero ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="param-actions">
              <button className="btn" onClick={() => actions.go('RESET')}>
                RESET DEFAULTS
              </button>
              <button className="btn" onClick={() => actions.runMC()} disabled={state.mcRunning}>
                {state.mcRunning ? 'MC RUNNING…' : 'RUN MONTE CARLO (5,000)'}
              </button>
              <button className="btn" onClick={() => actions.navigate('F2')}>
                INDIA IMPACT → F2
              </button>
            </div>
            {Object.keys(params.overrides).length > 0 && (
              <div className="muted">
                {Object.keys(params.overrides).length} EDITED ASSUMPTION(S) ACTIVE (F5 MODEL → ASSUMPTION REGISTER)
              </div>
            )}
            {result.warnings.length > 0 && (
              <ul className="warn-list">
                {result.warnings.map((w, i) => (
                  <li key={i} className="down">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <FactorBox {...props} />
      </div>
      <OriginTable {...props} />
    </div>
  );
}
