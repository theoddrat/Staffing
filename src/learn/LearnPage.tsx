// Learn: every term in the app, illustrated, with a live example from the data on screen.
// Searchable, grouped by topic, deep-linkable as #learn-<term> (underscores become hyphens).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../guided/icons';
import type { AppState, PanelProps } from '../panels/types';
import { ExplainerCard } from './ExplainerCard';
import { GLOSSARY, searchText, type Topic, TOPICS } from './glossary';
import { GLOSSARY_IDS, type GlossaryId } from './ids';
import { Illustration } from './illustrations';
import { consumeTerm, learnHash, onTermRequest, termFromHash } from './nav';
import { PageLearn, useLearn } from './Term';

const STORY: { n: number; title: string; text: string; id: GlossaryId }[] = [
  { n: 1, title: 'Imagine a what-if', text: 'Pick a hypothetical shock, such as Big Tech cutting AI spending. Nothing here is a forecast.', id: 'scenario' },
  { n: 2, title: 'US AI stocks take the hit', text: 'The AI boom runs on Big Tech’s spending. A cut, or a loss of confidence, hits US chip stocks first.', id: 'capex' },
  { n: 3, title: 'The shock crosses to India', text: 'It travels by five routes: parent companies, IT budgets, data-centre orders, investor mood and foreign money.', id: 'channel' },
  { n: 4, title: 'Some companies are more exposed', text: 'Four groups of Indian companies, from IT exporters to data-centre builders, are linked in different ways.', id: 'tier' },
  { n: 5, title: 'Two ways to size the fall', text: 'Past price behaviour gives one answer, damage to profits another. The gap between them shows overreaction.', id: 'gap' },
  { n: 6, title: 'How sure can we be?', text: 'Ranges show the spread of outcomes, and the accuracy lab tests the model on past shocks it never saw.', id: 'backtest' },
];

const anchor = (id: GlossaryId) => learnHash(id).slice(1);

export default function LearnPage({ state, actions }: PanelProps) {
  // The shell keeps the requested term in its store (not part of the AppState contract), read defensively.
  const learnTerm = (state as AppState & { learnTerm?: GlossaryId | null }).learnTerm ?? null;
  return (
    <PageLearn state={state} actions={actions}>
      <LearnBody learnTerm={learnTerm} />
    </PageLearn>
  );
}

function LearnBody({ learnTerm }: { learnTerm: GlossaryId | null }) {
  const ctx = useLearn();
  const data = useMemo(() => ({ bundle: ctx.bundle, result: ctx.result }), [ctx.bundle, ctx.result]);
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<Topic | 'all'>('all');
  const [flash, setFlash] = useState<GlossaryId | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const openRef = useRef(ctx.openLearn);
  openRef.current = ctx.openLearn;
  const goTo = useCallback((id: GlossaryId, sync = true) => {
    setQ('');
    setTopic('all');
    if (sync) {
      if (openRef.current) openRef.current(id);
      else {
        try {
          window.history.replaceState(null, '', learnHash(id));
        } catch {
          /* sandboxed host: keep the current URL */
        }
      }
    }
    // wait for the filters to clear before scrolling
    window.setTimeout(() => {
      const el = document.getElementById(anchor(id));
      if (!el) return;
      let smooth = true;
      try {
        smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        /* ignore */
      }
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      el.focus({ preventScroll: true });
      setFlash(id);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFlash(null), 2200);
    }, 30);
  }, []);

  useEffect(() => {
    if (learnTerm) goTo(learnTerm, false);
  }, [learnTerm, goTo]);

  useEffect(() => {
    const first = consumeTerm() ?? termFromHash(window.location.hash);
    if (first && !learnTerm) goTo(first, false);
    const off = onTermRequest((id) => goTo(id, false));
    const onHash = () => {
      const t = termFromHash(window.location.hash);
      if (t) goTo(t, false);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      off();
      window.removeEventListener('hashchange', onHash);
      window.clearTimeout(timer.current);
    };
  }, [goTo]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      GLOSSARY_IDS.filter((id) => {
        const e = GLOSSARY[id];
        if (topic !== 'all' && e.topic !== topic) return false;
        return !needle || searchText(e).includes(needle);
      }),
    [needle, topic],
  );

  return (
    <div className="lv-page lv-learn">
      <header className="lv-hero">
        <div className="lv-kicker">
          <Icon name="book" size={14} /> Learn
        </div>
        <h1 className="lv-h1">Every term, illustrated</h1>
        <p className="lv-lede">
          {GLOSSARY_IDS.length} ideas behind this app, each with a picture and a live example from today’s data. Tap any{' '}
          <span className="lv-chip lv-chip-demo" aria-hidden="true">
            ?
          </span>{' '}
          elsewhere in the app to see the same card in place.
        </p>
      </header>

      {!needle && topic === 'all' && (
        <section className="lv-story" aria-labelledby="lv-start">
          <h2 className="lv-h2" id="lv-start">
            <Icon name="play" size={18} /> Start here: the whole idea in six steps
          </h2>
          <ol className="lv-story-grid">
            {STORY.map((s) => (
              <li key={s.n} className="lv-story-card">
                <button type="button" className="lv-story-btn" onClick={() => goTo(s.id)} aria-label={`Step ${s.n}: ${s.title}. Read about ${GLOSSARY[s.id].term}`}>
                  <span className="lv-step">{s.n}</span>
                  <span className="lv-story-title">{s.title}</span>
                  <span className="lv-story-ill">
                    <Illustration id={GLOSSARY[s.id].ill} bundle={data.bundle} result={data.result} compact focus={GLOSSARY[s.id].illFocus} variant={GLOSSARY[s.id].illVariant} />
                  </span>
                  <span className="lv-story-text">{s.text}</span>
                  <span className="lv-story-more">
                    {GLOSSARY[s.id].term} <Icon name="arrowRight" size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="lv-toolbar" role="search">
        <label className="lv-search">
          <Icon name="help" size={16} />
          <span className="lv-sr">Search terms</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: beta, crore, P/E, drawdown…" autoComplete="off" />
        </label>
        <div className="lv-chips" role="group" aria-label="Topic">
          <button type="button" className={`lv-chipbtn${topic === 'all' ? ' on' : ''}`} aria-pressed={topic === 'all'} onClick={() => setTopic('all')}>
            All
          </button>
          {TOPICS.map((t) => (
            <button key={t.id} type="button" className={`lv-chipbtn${topic === t.id ? ' on' : ''}`} aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}>
              <Icon name={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </div>
        <div className="lv-count" aria-live="polite">
          {needle || topic !== 'all' ? `${visible.length} of ${GLOSSARY_IDS.length} terms` : ''}
        </div>
      </div>

      {visible.length === 0 && (
        <p className="lv-empty">
          No term matches “{q}”. Try a plainer word, for example “rupee”, “profit” or “range”.
        </p>
      )}

      {TOPICS.map((t) => {
        const ids = visible.filter((id) => GLOSSARY[id].topic === t.id);
        if (!ids.length) return null;
        return (
          <section key={t.id} className="lv-topic" aria-labelledby={`lv-topic-${t.id}`}>
            <h2 className="lv-h2" id={`lv-topic-${t.id}`}>
              <Icon name={t.icon} size={18} /> {t.label} <span className="lv-count-sm">{ids.length}</span>
            </h2>
            <p className="lv-muted">{t.blurb}</p>
            <div className="lv-grid">
              {ids.map((id) => (
                <article key={id} id={anchor(id)} className={`lv-card lv-term-card${flash === id ? ' lv-flash' : ''}`} tabIndex={-1}>
                  <ExplainerCard id={id} data={data} onRelated={(r) => goTo(r)} />
                  <a className="lv-permalink" href={learnHash(id)} onClick={(e) => { e.preventDefault(); goTo(id); }} aria-label={`Link to ${GLOSSARY[id].term}`}>
                    #
                  </a>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
