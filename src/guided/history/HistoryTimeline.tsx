// ④ Past crashes: an ordinal timeline from the 1840s railway mania to the 2024–26 AI shocks, and a
// story card per case (what broke, how far prices fell, how India reacted, sources).
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { TIER_VIS } from '../visual';
import type { PanelProps } from '../../panels/types';
import type { DataBundle, Drawdown, HistoryCase, Source } from '../../types/data';
import { isNum } from '../../lib/format';
import { matchFocus } from '../../panels/b/util';
import { displayOf, fmtDate, fmtNum, pctWord } from '../../learn/data';
import { EventChart } from '../../learn/illustrations/history';
import { HelpChip, PageLearn, Term } from '../../learn/Term';
import { caseReplay, caseStudy, CRASH_VIS, type Era, eraMonths, eras } from './timeline';

export default function HistoryTimeline({ state, actions }: PanelProps) {
  const { bundle, historyFocus } = state;
  const cases = bundle.history?.cases ?? [];
  const groups = useMemo(() => eras(cases), [cases]);
  const fromFocus = useMemo(() => {
    const m = matchFocus(
      historyFocus,
      cases.map((c) => ({ id: c.id, name: c.name })),
      (bundle.history?.event_studies ?? []).map((e) => ({ id: e.id, label: e.label })),
    );
    if (m.caseId) return m.caseId;
    if (m.eventId) return cases.find((c) => caseStudy(c, bundle.history.event_studies)?.id === m.eventId)?.id ?? null;
    return null;
  }, [historyFocus, cases, bundle.history]);
  const [sel, setSel] = useState<string | null>(() => fromFocus ?? (cases.some((c) => c.id === 'dotcom') ? 'dotcom' : (cases[0]?.id ?? null)));
  useEffect(() => {
    if (fromFocus) setSel(fromFocus);
  }, [fromFocus]);
  const c = cases.find((x) => x.id === sel) ?? null;

  const replay = (windowId: string) => {
    actions.setPreset('replay');
    actions.setValue('window', windowId);
    actions.setView?.('impact');
  };

  return (
    <PageLearn state={state} actions={actions}>
      <div className="lv-page lv-hist">
        <header className="lv-hero">
          <div className="lv-kicker">
            <Icon name="clock" size={14} /> Past crashes
          </div>
          <h1 className="lv-h1">What happened before</h1>
          <p className="lv-lede">
            {cases.length} bubbles, crashes and shocks, from the {groups[0]?.label ?? 'past'} to {fmtDate(bundle.meta?.as_of, true) || 'today'}. Pick one to see
            what broke, how far prices fell, and how Indian stocks reacted. Every fall is measured from the peak <HelpChip id="drawdown" />.
          </p>
        </header>

        <Legend />
        {cases.length ? <Timeline groups={groups} sel={sel} onSel={setSel} /> : <p className="lv-empty">No history cases in this data build.</p>}
        {c && <Story c={c} bundle={bundle} onReplay={replay} />}
      </div>
    </PageLearn>
  );
}

function Legend() {
  return (
    <section className="lv-legend-row" aria-label="Kinds of crash">
      {(Object.keys(CRASH_VIS) as (keyof typeof CRASH_VIS)[]).map((k) => {
        const v = CRASH_VIS[k];
        return (
          <span key={k} className="lv-ctype" style={{ ['--c' as string]: v.color }}>
            <span className="lv-ctype-ico">
              <Icon name={v.icon} size={14} />
            </span>
            {v.label}
            <HelpChip id={v.term} />
          </span>
        );
      })}
    </section>
  );
}

function Timeline({ groups, sel, onSel }: { groups: Era[]; sel: string | null; onSel: (id: string) => void }) {
  return (
    <nav className="lv-timeline" aria-label="Timeline of past crashes">
      {groups.map((e) => (
        <div key={e.key} className="lv-era-wrap">
          {e.gapBefore !== null && (
            <div className="lv-gap" aria-hidden="true">
              <span className="lv-gap-line" />
              <span className="lv-gap-label">{e.gapBefore >= 1.5 ? `≈${Math.round(e.gapBefore)} yrs` : ''}</span>
            </div>
          )}
          <div className={`lv-era${e.cluster ? ' lv-cluster' : ''}`}>
            <div className="lv-era-label">
              {e.label}
              {e.cluster && <span className="lv-era-sub">{`AI-shock cluster: ${e.cases.length} shocks in ${eraMonths(e)} months`}</span>}
            </div>
            <ol className="lv-era-cases">
              {e.cases.map((c) => {
                const t = c.crash_types[0];
                const v = t ? CRASH_VIS[t] : null;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`lv-case${sel === c.id ? ' on' : ''}`}
                      aria-pressed={sel === c.id}
                      onClick={() => onSel(c.id)}
                      style={{ ['--c' as string]: v?.color ?? 'var(--g-accent)' }}
                    >
                      <span className="lv-case-dot">{v && <Icon name={v.icon} size={13} />}</span>
                      <span className="lv-case-name">{c.name}</span>
                      <span className="lv-case-date">{c.period}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ))}
    </nav>
  );
}

function ddLabel(d: Drawdown): string {
  return d.label.replace(/\s*\(.*\)\s*$/, '');
}

function Story({ c, bundle, onReplay }: { c: HistoryCase; bundle: DataBundle; onReplay: (windowId: string) => void }) {
  const [allDd, setAllDd] = useState(false);
  const [allNotes, setAllNotes] = useState(false);
  useEffect(() => {
    setAllDd(false);
    setAllNotes(false);
  }, [c.id]);
  const es = caseStudy(c, bundle.history.event_studies);
  const rw = caseReplay(c, bundle.history.replay_windows);
  const dds = c.drawdowns.filter((d) => isNum(d.drawdown)).sort((a, b) => (a.drawdown as number) - (b.drawdown as number));
  const shown = allDd ? dds : dds.slice(0, 6);
  const maxDd = Math.max(0.05, ...dds.map((d) => Math.abs(d.drawdown as number)));
  const byId = new Map<string, Source>(bundle.sources.map((s) => [s.id, s]));
  const srcs = c.src.map((id) => byId.get(id)).filter((s): s is Source => !!s);
  const notes = allNotes ? c.notes : c.notes.slice(0, 3);
  const ds = c.id === 'deepseek' ? (bundle.history.deepseek_next_day ?? []).filter((r) => isNum(r.r_jan28)).slice(0, 8) : [];
  const dsMax = Math.max(0.05, ...ds.map((r) => Math.abs(r.r_jan28 as number)));
  return (
    <article className="lv-card lv-story-case" aria-live="polite" aria-labelledby="lv-case-title">
      <header className="lv-case-head">
        <h2 className="lv-h2" id="lv-case-title">
          {c.name}
        </h2>
        <span className="lv-case-period">{c.period}</span>
        <div className="lv-case-types">
          {c.crash_types.map((t) => (
            <span key={t} className="lv-ctype" style={{ ['--c' as string]: CRASH_VIS[t].color }}>
              <span className="lv-ctype-ico">
                <Icon name={CRASH_VIS[t].icon} size={14} />
              </span>
              {CRASH_VIS[t].label}
              <HelpChip id={CRASH_VIS[t].term} />
            </span>
          ))}
        </div>
      </header>

      <div className="lv-case-grid">
        <section>
          <h3 className="lv-h3">What broke</h3>
          <p>{c.what_broke}</p>
          {c.linked && (
            <>
              <h3 className="lv-h3">What fell with it</h3>
              <p>{c.linked}</p>
            </>
          )}
          {c.india && (
            <>
              <h3 className="lv-h3">India</h3>
              <p>{c.india}</p>
            </>
          )}
          {rw && (
            <button type="button" className="lv-cta" onClick={() => onReplay(rw.id)}>
              <Icon name="play" size={15} /> Replay this on today’s Indian stocks
            </button>
          )}
        </section>

        <section aria-labelledby="lv-dd">
          <h3 className="lv-h3" id="lv-dd">
            How far prices fell <HelpChip id="drawdown" />
          </h3>
          {dds.length ? (
            <ul className="lv-dds">
              {shown.map((d, i) => (
                <li key={`${d.label}-${i}`}>
                  <div className="lv-dd-top">
                    <span className="lv-dd-name">{ddLabel(d)}</span>
                    <span className="lv-num dn">{pctWord(d.drawdown, 0)}</span>
                  </div>
                  <span className="lv-dd-track">
                    <span className="lv-dd-fill" style={{ width: `${(Math.abs(d.drawdown as number) / maxDd) * 100}%` }} />
                  </span>
                  <div className="lv-dd-sub">
                    {d.peak_date && d.trough_date ? `${fmtDate(d.peak_date, true)} → ${fmtDate(d.trough_date, true)}` : ''}
                    {isNum(d.days_to_bottom) ? ` · ${d.days_to_bottom} trading days down` : ''}
                    {d.recovered_date
                      ? ` · back to the peak ${fmtDate(d.recovered_date, true)}`
                      : d.status === 'COMPUTED' && d.trough_date
                        ? ' · not back to the peak in the data'
                        : ''}
                    {d.status !== 'COMPUTED' && <span className="lv-status">{d.status === 'SOURCED' ? 'sourced' : d.status.toLowerCase().replace('_', ' ')}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lv-muted">No price series for this case in the data; see its sources.</p>
          )}
          {dds.length > 6 && (
            <button type="button" className="lv-more" onClick={() => setAllDd((x) => !x)}>
              {allDd ? 'Show the 6 deepest' : `Show all ${dds.length}`}
            </button>
          )}
        </section>
      </div>

      {es && (
        <section className="lv-case-es" aria-labelledby="lv-es">
          <h3 className="lv-h3" id="lv-es">
            The extra fall beyond the market, day by day <HelpChip id="car" />
          </h3>
          <p className="lv-muted">
            Average <Term id="car">cumulative abnormal return</Term> for each group, from 5 trading days before {fmtDate(es.date)} to 60 after.
          </p>
          <div className="lv-es-chart">
            <EventChart es={es} />
          </div>
        </section>
      )}

      {ds.length > 0 && (
        <section aria-labelledby="lv-ds">
          <h3 className="lv-h3" id="lv-ds">
            Indian stocks the next session (28 Jan 2025)
          </h3>
          <ul className="lv-sbars">
            {ds.map((r) => (
              <li key={r.ticker}>
                <span className="lv-sb-l">
                  <span className="lv-tierdot" style={{ background: r.tier ? TIER_VIS[r.tier].color : 'var(--g-faint)' }} />
                  {displayOf(bundle, r.ticker)}
                </span>
                <span className="lv-sb-track">
                  <span className="lv-sb-dn" style={{ width: `${(Math.abs(r.r_jan28 as number) / dsMax) * 100}%` }} />
                </span>
                <span className="lv-num lv-sb-v dn">{pctWord(r.r_jan28, 1)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.notes.length > 0 && (
        <section aria-labelledby="lv-notes">
          <h3 className="lv-h3" id="lv-notes">
            Notes
          </h3>
          <ul className="lv-notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          {c.notes.length > 3 && (
            <button type="button" className="lv-more" onClick={() => setAllNotes((x) => !x)}>
              {allNotes ? 'Fewer notes' : `All ${c.notes.length} notes`}
            </button>
          )}
        </section>
      )}

      {srcs.length > 0 && (
        <section aria-labelledby="lv-src">
          <h3 className="lv-h3" id="lv-src">
            Sources <HelpChip id="sourced" />
          </h3>
          <ul className="lv-sources">
            {srcs.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
                <span className="lv-muted">
                  {[s.publisher, s.date ? fmtDate(s.date) || s.date : null].filter(Boolean).join(' · ')}
                </span>
                <span className={`lv-ver lv-ver-${s.verification.toLowerCase()}`}>{s.verification.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="lv-hint">{`Event-study and price numbers are computed from public price history${es ? `; ${es.groups.length} groups, ${fmtNum(es.groups.reduce((s, g) => s + g.members.length, 0), 0)} stocks` : ''}.`}</p>
    </article>
  );
}
