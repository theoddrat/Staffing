// F6 SOURCES — every citation, the ticker verification log, and data provenance.
import { useState } from 'react';
import type { PanelProps } from './types';
import '../styles/panels-b.css';
import { HelpChip } from '../learn/Term';
import { SubTabs } from './b/common';
import { Provenance, SourcesTable, TickerLog } from './b/sources/SourcesViews';

const TABS = [
  { id: 'sources', label: 'Sources' },
  { id: 'tickers', label: 'Ticker log' },
  { id: 'provenance', label: 'Provenance & legend' },
];

export default function SourcesPanel({ state }: PanelProps) {
  const { bundle } = state;
  const [tab, setTab] = useState('sources');
  return (
    <div className="b-root" data-panel="F6">
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-header">
          <span>
            F6 SOURCES — citations, verification log, provenance <HelpChip id="sourced" /> <HelpChip id="unverified" /> <HelpChip id="user_assumption" />
          </span>
          <span className="spacer" />
          <span className="muted">
            {bundle.sources?.length ?? 0} sources · {bundle.meta?.ticker_log?.length ?? 0} tickers checked · built {bundle.meta?.built_at ?? '—'}
          </span>
        </div>
        <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === 'sources' && <SourcesTable bundle={bundle} />}
      {tab === 'tickers' && <TickerLog bundle={bundle} />}
      {tab === 'provenance' && <Provenance bundle={bundle} />}
    </div>
  );
}
