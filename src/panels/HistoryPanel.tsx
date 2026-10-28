// F4 HISTORY — historical evidence: bubble crashes, accounting scandals, event studies, calibration.
import { useEffect, useMemo, useState } from 'react';
import type { PanelProps } from './types';
import '../styles/panels-b.css';
import { SubTabs } from './b/common';
import { matchFocus } from './b/util';
import CasesTable from './b/history/CasesTable';
import EventStudies from './b/history/EventStudies';
import { PeDrawdownScatter, UsIndiaScatter } from './b/history/Scatters';
import { CalibrationCheck, DeepSeekTable, DotcomOverlay } from './b/history/OverlayCalib';

const TABS = [
  { id: 'cases', label: 'Cases' },
  { id: 'events', label: 'Event studies' },
  { id: 'scatter', label: 'US shock vs India' },
  { id: 'pe', label: 'P/E vs drawdown' },
  { id: 'overlay', label: 'Dot-com overlay' },
  { id: 'deepseek', label: 'DeepSeek next day' },
  { id: 'calib', label: 'Calibration' },
];

export default function HistoryPanel({ state }: PanelProps) {
  const { bundle, result, historyFocus } = state;
  const cases = bundle.history?.cases ?? [];
  const events = bundle.history?.event_studies ?? [];
  const focus = useMemo(
    () =>
      matchFocus(
        historyFocus,
        cases.map((c) => ({ id: c.id, name: c.name })),
        events.map((e) => ({ id: e.id, label: e.label })),
      ),
    [historyFocus, cases, events],
  );
  const [tab, setTab] = useState<string>(() => (focus.caseId ? 'cases' : focus.eventId ? 'events' : 'cases'));

  useEffect(() => {
    if (!historyFocus) return;
    const f = historyFocus.trim().toLowerCase();
    if (f === 'deepseek' && bundle.history?.deepseek_next_day?.length && !focus.caseId) setTab('deepseek');
    else if (focus.caseId) setTab('cases');
    else if (focus.eventId) setTab('events');
  }, [historyFocus, focus.caseId, focus.eventId, bundle.history]);

  return (
    <div className="b-root" data-panel="F4">
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-header">
          <span>F4 HISTORY — historical evidence: bubble crashes, accounting scandals, and how India was hit</span>
          <span className="spacer" />
          <span className="muted">
            {cases.length} cases · {events.length} event studies · data as of {bundle.meta?.as_of ?? '—'}
          </span>
        </div>
        <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === 'cases' && (
        <div className="panel">
          <div className="panel-body">
            <CasesTable bundle={bundle} focusCaseId={focus.caseId} />
          </div>
        </div>
      )}
      {tab === 'events' && <EventStudies bundle={bundle} focusEventId={focus.eventId} />}
      {tab === 'scatter' && <UsIndiaScatter bundle={bundle} />}
      {tab === 'pe' && <PeDrawdownScatter bundle={bundle} />}
      {tab === 'overlay' && <DotcomOverlay bundle={bundle} />}
      {tab === 'deepseek' && <DeepSeekTable bundle={bundle} />}
      {tab === 'calib' && <CalibrationCheck bundle={bundle} result={result} />}
    </div>
  );
}
