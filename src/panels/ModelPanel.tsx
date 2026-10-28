// F5 MODEL — formulas, regression tables, rolling betas, heatmap, factor/FX calibration, assumption register.
import { useState } from 'react';
import type { PanelProps } from './types';
import '../styles/panels-b.css';
import { SubTabs } from './b/common';
import Formulas from './b/model/Formulas';
import Regressions from './b/model/Regressions';
import Rolling from './b/model/Rolling';
import Heatmap from './b/model/Heatmap';
import FactorsFx from './b/model/FactorsFx';
import OpLeverage from './b/model/OpLeverage';
import AssumptionRegister from './b/model/AssumptionRegister';

const TABS = [
  { id: 'formulas', label: 'Formulas' },
  { id: 'regressions', label: 'Regressions' },
  { id: 'rolling', label: 'Rolling betas' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'factors', label: 'Factors & FX' },
  { id: 'ol', label: 'Op leverage' },
  { id: 'assumptions', label: 'Assumptions' },
];

export default function ModelPanel({ state, actions }: PanelProps) {
  const { bundle, params, selected } = state;
  const [tab, setTab] = useState('formulas');
  const isIndia = (t: string | null) => !!t && (bundle.india ?? []).some((x) => x.ticker === t);
  const rollTicker = isIndia(selected) ? selected : bundle.india?.[0]?.ticker ?? null;
  const select = (t: string) => {
    actions.select(t);
  };

  return (
    <div className="b-root" data-panel="F5">
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-header">
          <span>F5 MODEL — the math, the regressions and every assumption</span>
          <span className="spacer" />
          <span className="muted">
            window {bundle.meta?.regression_window?.start ?? '—'} → {bundle.meta?.regression_window?.end ?? '—'} · {bundle.india?.length ?? 0} India targets ·{' '}
            {bundle.origins?.length ?? 0} origins
          </span>
        </div>
        <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === 'formulas' && <Formulas bundle={bundle} />}
      {tab === 'regressions' && (
        <Regressions
          bundle={bundle}
          selected={selected}
          onSelect={(t) => {
            select(t);
            setTab('rolling');
          }}
        />
      )}
      {tab === 'rolling' && <Rolling bundle={bundle} ticker={rollTicker} onSelect={select} />}
      {tab === 'heatmap' && (
        <Heatmap
          bundle={bundle}
          onSelect={(t) => {
            select(t);
          }}
        />
      )}
      {tab === 'factors' && <FactorsFx bundle={bundle} />}
      {tab === 'ol' && <OpLeverage bundle={bundle} />}
      {tab === 'assumptions' && <AssumptionRegister bundle={bundle} params={params} actions={actions} />}
    </div>
  );
}
