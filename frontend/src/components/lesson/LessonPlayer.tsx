"use client";

import Link from "next/link";
import { BookOpen, Check, ChevronRight, HelpCircle, MessagesSquare, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, refreshProgress, useAIStatus, useCurriculum, useLesson, useProgress } from "@/lib/api";
import type { Example, LessonOut, NodeOut } from "@/lib/types";
import { Widget } from "@/widgets/registry";
import { looksLikeMath } from "@/lib/richtext";
import { RichText } from "../RichText";
import { KindBadge, KindLegend, StatementList } from "../Statements";
import { Tex } from "../Tex";
import { useTerms } from "../TermContext";
import { TutorChat } from "../TutorChat";
import { Button, Card, ErrorNote, Loading, StateBadge } from "../ui";
import { Assessment } from "./Assessment";
import { DontUnderstand } from "./DontUnderstand";
import { PracticePanel } from "./PracticePanel";

type SectionDef = { id: string; title: string; step?: string };

function storageGet<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function storageSet(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is a convenience only */
  }
}

function Section({ id, title, step, children }: SectionDef & { children: ReactNode }) {
  return (
    <section id={id} data-section={id} className="scroll-mt-24">
      <header className="mb-3">
        {step ? <p className="text-xs font-semibold tracking-wide text-accent uppercase">{step}</p> : null}
        <h2 className="text-xl font-semibold">{title}</h2>
      </header>
      {children}
    </section>
  );
}

/** A worked example revealed one step at a time, so no step is skipped. */
function StepReveal({ ex }: { ex: Example }) {
  const [shown, setShown] = useState(1);
  const all = shown > ex.steps.length;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-semibold">{ex.title}</h3>
      <div className="mt-1"><RichText text={ex.problem} /></div>
      {ex.visual ? (
        <div className="mt-3 rounded-lg border border-line p-3">
          <Widget widget={ex.visual.widget} props={ex.visual.props} />
          <p className="mt-2 text-sm text-ink-2"><RichText text={ex.visual.caption} inline /></p>
        </div>
      ) : null}
      <ol className="mt-3 space-y-2">
        {ex.steps.slice(0, shown).map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
            <div className="flex-1"><RichText text={s} /></div>
          </li>
        ))}
      </ol>
      {all ? (
        <div className="mt-3 rounded-lg bg-good-soft px-3 py-2"><span className="font-semibold text-good">Answer: </span><RichText text={ex.answer} inline /></div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button onClick={() => setShown(shown + 1)}>{shown < ex.steps.length ? "Next step" : "Show the answer"}</Button>
          <Button variant="ghost" onClick={() => setShown(ex.steps.length + 1)}>Show everything</Button>
        </div>
      )}
    </div>
  );
}

function NodeChip({ n, state }: { n: NodeOut; state?: string }) {
  return (
    <Link href={`/learn/${n.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm hover:border-accent">
      {state ? <StateBadge state={state as never} /> : null}
      {n.title}
      {!n.available ? <span className="text-xs text-ink-3">(planned)</span> : null}
    </Link>
  );
}

function PlannedLesson({ id }: { id: string }) {
  const { data: cur } = useCurriculum();
  const ai = useAIStatus();
  const [thread, setThread] = useState<string | null>(null);
  const node = cur?.lessons.find((l) => l.id === id);
  if (!cur) return <Loading />;
  if (!node) return <ErrorNote error={{ message: `There is no lesson called "${id}".` }} />;
  const stage = cur.stages.find((s) => s.id === node.stage);
  const byId = new Map(cur.lessons.map((l) => [l.id, l]));
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-ink-3">{stage?.title}</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">{node.title}</h1>
        <p className="mt-2 text-lg text-ink-2">{node.summary}</p>
      </header>
      <Card>
        <p className="font-semibold">This lesson is planned but not written yet.</p>
        <p className="mt-1 text-ink-2">
          It is part of the curriculum map, so you can see where it fits and what it needs. The written lessons currently cover Levels 0 and 1;
          more are added level by level, following the prerequisite graph.
        </p>
      </Card>
      <div>
        <h2 className="mb-2 font-semibold">It builds on</h2>
        <div className="flex flex-wrap gap-2">{node.pre.length ? node.pre.map((p) => <NodeChip key={p} n={byId.get(p)!} />) : <span className="text-ink-3">nothing - it is a starting point</span>}</div>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">It leads to</h2>
        <div className="flex flex-wrap gap-2">
          {cur.lessons.filter((l) => l.pre.includes(id)).map((l) => <NodeChip key={l.id} n={l} />)}
        </div>
      </div>
      <Card>
        <h2 className="mb-2 font-semibold">Explore it with the tutor</h2>
        {ai.data?.configured ? (
          <>
            <p className="mb-3 text-sm text-ink-2">The tutor can introduce this topic now, starting from what you already know (its explanations are AI-written, not a reviewed lesson).</p>
            <TutorChat threadId={thread} onThread={setThread} lessonId={id} compact />
          </>
        ) : (
          <p className="text-sm text-ink-2">With the AI tutor switched on (see Settings), you could explore this topic before its lesson is written.</p>
        )}
      </Card>
      <Link href={`/map?focus=${id}`} className="text-accent hover:underline">See it on the knowledge map →</Link>
    </div>
  );
}

export function LessonPlayer({ id }: { id: string }) {
  const { data: cur } = useCurriculum();
  const node = cur?.lessons.find((l) => l.id === id);
  // Only request the lesson body when the curriculum says it has been written.
  const { data, error } = useLesson(cur && node?.available ? id : null);
  if (cur && !node?.available) return <PlannedLesson id={id} />;
  if (error?.status === 404) return <PlannedLesson id={id} />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading what="Loading the lesson" />;
  return <LessonBody key={id} data={data} />;
}

function LessonBody({ data }: { data: LessonOut }) {
  const L = data.lesson;
  const id = L.id;
  const { data: cur } = useCurriculum();
  const { data: prog } = useProgress();
  const { terms, openTerm } = useTerms();
  const [newTerms, setNewTerms] = useState<string[]>([]);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState("goal");
  const [confused, setConfused] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  // per-lesson conveniences remembered in this browser (LessonBody remounts for each lesson)
  const [threadId, setThreadId] = useState<string | null>(() => storageGet<string | null>(`tutor-thread:${id}`, null));
  const [seenStrategies, setSeenStrategies] = useState<string[]>(() => storageGet<string[]>(`seen-strategies:${id}`, []));
  const [hideReadiness, setHideReadiness] = useState(false);
  const [experimentDone, setExperimentDone] = useState(false);
  const [assessRun, setAssessRun] = useState<{ key: number; mode: "lesson" | "test_out" } | null>(null);
  const opened = useRef(false);
  const recorded = useRef<Set<string>>(new Set());

  const stage = cur?.stages.find((s) => s.id === data.node.stage);
  const states = prog?.states ?? {};
  const stateOf = (lid: string) => states[lid]?.state ?? "not_started";

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    api.openLesson(id).then((r) => {
      setNewTerms(r.new_terms);
      void refreshProgress();
    }).catch(() => {});
  }, [id]);

  const sections: SectionDef[] = useMemo(() => {
    const s: SectionDef[] = [
      { id: "goal", title: "What we are learning", step: "Start here" },
      { id: "plain", title: "In plain words", step: "Step 1 · Ordinary language" },
      { id: "analogy", title: "An everyday picture", step: "Step 2 · Analogy" },
      { id: "visual", title: "See it", step: "Step 3 · Visual" },
      { id: "examples", title: "Examples", step: "Step 4 · Small examples" },
      { id: "word", title: "The mathematical word", step: "Step 5 · The word" },
      { id: "symbol", title: L.symbols.length ? (L.symbols.length > 1 ? "The symbols" : "The symbol") : "Is there a symbol?", step: "Step 6 · The symbol" },
      { id: "formal", title: "The precise definition", step: "Step 7 · Formal definition" },
    ];
    if (L.notation.length) s.push({ id: "notation", title: "Reading the notation, symbol by symbol" });
    s.push(
      { id: "connections", title: "How it connects to what you know", step: "Step 8 · Connections" },
      { id: "worked", title: "A worked problem" },
      { id: "experiment", title: "Try it yourself", step: "Step 9 · Experiment" },
      { id: "mistakes", title: "Common mistakes" },
    );
    if (L.statements.length) s.push({ id: "statements", title: "What is proved - and what is not" });
    s.push(
      { id: "assessment", title: "Check your understanding", step: "Step 10 · Check" },
      { id: "forward", title: "Where this leads" },
    );
    return s;
  }, [L]);

  // Track which sections have been read.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const sid = (e.target as HTMLElement).dataset.section!;
          setCurrent(sid);
          setViewed((v) => (v.has(sid) ? v : new Set([...v, sid])));
          if (!recorded.current.has(sid)) {
            recorded.current.add(sid);
            api.lessonEvent(id, "section_viewed", { section: sid }).catch(() => {});
          }
        }
      },
      { rootMargin: "-20% 0px -55% 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [id, sections]);

  const onExperimentDone = useCallback((d?: Record<string, unknown>) => {
    setExperimentDone(true);
    api.lessonEvent(id, "experiment_completed", d ?? {}).catch(() => {});
  }, [id]);

  const startTestOut = () => {
    setAssessRun({ key: Date.now(), mode: "test_out" });
    document.getElementById("assessment")?.scrollIntoView({ behavior: "smooth" });
  };

  const missing = data.readiness.missing.filter((m) => !["understood", "mastered"].includes(stateOf(m.id)));
  const showReadiness = !hideReadiness && missing.length > 0 && !["understood", "mastered"].includes(data.state.state);
  const sectionTitle = sections.find((s) => s.id === current)?.title ?? null;

  return (
    <div className="lg:grid lg:grid-cols-[1fr_200px] lg:gap-10">
      <article className="min-w-0 space-y-12">
        {/* -------------------------------------------------------------- header */}
        <header className="space-y-3">
          <nav className="flex items-center gap-1 text-sm text-ink-3" aria-label="Breadcrumb">
            <Link href="/learn" className="hover:text-ink">Curriculum</Link><ChevronRight size={14} />
            <span>{stage ? `Level ${stage.number ?? ""} · ${stage.title}` : data.node.stage}</span>
          </nav>
          <h1 className="font-serif text-3xl font-semibold sm:text-4xl">{data.node.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <StateBadge state={stateOf(id) as never} />
            <span>about {L.estimated_minutes} minutes</span>
            {data.node.feeds.includes("rh") ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs text-rh">on the road to the Riemann Hypothesis</span> : null}
            {data.node.feeds.includes("pnp") ? <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs text-pnp">on the road to P vs NP</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={startTestOut}>Already know this? Test out</Button>
            <Button variant="ghost" onClick={() => setTutorOpen(true)}><MessagesSquare size={16} /> Ask the tutor</Button>
          </div>
          {newTerms.length ? (
            <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-2 text-sm">
              <BookOpen size={15} className="text-accent" />
              {newTerms.length} {newTerms.length === 1 ? "word was" : "words were"} added to your dictionary:
              {newTerms.slice(0, 8).map((t) => (
                <button key={t} type="button" className="term-link" onClick={() => openTerm(t)}>{terms.get(t)?.word ?? t}</button>
              ))}
              {newTerms.length > 8 ? "…" : null}
            </p>
          ) : null}
        </header>

        {showReadiness ? (
          <Card className="border-warn/40">
            <p className="font-semibold">Before you begin</p>
            <p className="mt-1 text-ink-2">
              This lesson builds on {missing.length === 1 ? "an idea" : "some ideas"} you have not marked as understood yet. That is completely
              fine - mathematics is cumulative, and a quick look back often makes the new idea easy.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {missing.slice(0, 6).map((m) => <NodeChip key={m.id} n={m} state={stateOf(m.id)} />)}
              {missing.length > 6 ? <span className="self-center text-sm text-ink-3">and {missing.length - 6} more earlier lessons</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/learn/${missing[0].id}`} className="inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
                Start with {missing[0].title}
              </Link>
              <Button onClick={() => setHideReadiness(true)}>Continue anyway</Button>
            </div>
          </Card>
        ) : null}

        {/* -------------------------------------------------------------- 1-3 */}
        <Section {...sections[0]}>
          <div className="space-y-4">
            <RichText text={L.goal} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-2/60 p-4"><p className="mb-1 text-sm font-semibold text-ink-2">Why it exists</p><RichText text={L.why} /></div>
              <div className="rounded-xl bg-surface-2/60 p-4"><p className="mb-1 text-sm font-semibold text-ink-2">The problem it solves</p><RichText text={L.problem} /></div>
            </div>
          </div>
        </Section>

        <Section {...sections[1]}><RichText text={L.plain} /></Section>

        <Section {...sections[2]}>
          <Card><h3 className="mb-2 font-semibold">{L.analogy.title}</h3><RichText text={L.analogy.text} /></Card>
        </Section>

        <Section {...sections[3]}>
          <Card>
            <Widget widget={L.visual.widget} props={L.visual.props} />
            <div className="mt-3 border-t border-line pt-3 text-sm text-ink-2"><RichText text={L.visual.caption} /></div>
            {L.visual.prompt ? <p className="mt-2 text-sm font-medium"><RichText text={L.visual.prompt} inline /></p> : null}
          </Card>
        </Section>

        <Section {...sections[4]}>
          <div className="space-y-4">
            <p className="text-sm text-ink-3">A simple example first, then a slightly harder one. Reveal one step at a time.</p>
            <StepReveal ex={L.example_simple} />
            <StepReveal ex={L.example_harder} />
          </div>
        </Section>

        <Section {...sections[5]}>
          <RichText text={L.word.text} />
          <div className="mt-3 flex flex-wrap gap-2">
            {L.word.terms.map((t) => (
              <button key={t} type="button" onClick={() => openTerm(t)}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
                <BookOpen size={14} /> {terms.get(t)?.word ?? t}
              </button>
            ))}
          </div>
        </Section>

        <Section {...sections[6]}>
          {L.symbols.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {L.symbols.map((s) => (
                <Card key={s.name}>
                  <div className="flex items-center gap-4">
                    <span className="flex h-16 min-w-16 items-center justify-center rounded-xl bg-surface-2 px-3 text-3xl"><Tex tex={s.symbol} /></span>
                    <h3 className="font-semibold">{s.name}</h3>
                  </div>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="font-semibold text-ink-2">What it looks like</dt><dd><RichText text={s.looks_like} inline /></dd></div>
                    <div><dt className="font-semibold text-ink-2">What it means</dt><dd><RichText text={s.means} inline /></dd></div>
                    <div><dt className="font-semibold text-ink-2">Why mathematicians use it</dt><dd><RichText text={s.why} inline /></dd></div>
                    <div><dt className="font-semibold text-ink-2">How to read it aloud</dt><dd><RichText text={s.read_aloud} inline /></dd></div>
                  </dl>
                </Card>
              ))}
            </div>
          ) : (
            <RichText text={L.no_symbol_note ?? ""} />
          )}
        </Section>

        <Section {...sections[7]}>
          <Card>
            <KindBadge kind={L.formal.kind ?? "definition"} />
            <div className="mt-2 text-lg"><RichText text={L.formal.statement} /></div>
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-sm font-semibold text-ink-2">Every word in that definition</p>
              <dl className="grid gap-2 sm:grid-cols-2">
                {L.formal.glossary.map((g) => (
                  <div key={g.word} className="rounded-lg bg-surface-2/60 px-3 py-2 text-sm">
                    <dt className="font-semibold"><RichText text={looksLikeMath(g.word) ? `$${g.word}$` : g.word} inline link={false} /></dt>
                    <dd className="text-ink-2"><RichText text={g.meaning} inline /></dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>
        </Section>

        {L.notation.length ? (
          <Section {...sections.find((s) => s.id === "notation")!}>
            <div className="space-y-4">
              {L.notation.map((n, i) => (
                <Card key={i}>
                  <div className="overflow-x-auto text-2xl"><Tex tex={n.expression} display /></div>
                  <p className="text-center text-sm text-ink-2">Read aloud: &ldquo;{n.read_aloud}&rdquo;</p>
                  <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
                    {n.parts.map((p, j) => (
                      <li key={j} className="flex items-start gap-3">
                        <span className="min-w-14 rounded bg-surface-2 px-2 py-0.5 text-center"><Tex tex={p.symbol} /></span>
                        <span className="flex-1"><RichText text={p.meaning} inline /></span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm"><strong>In plain English: </strong><RichText text={n.english} inline /></p>
                </Card>
              ))}
            </div>
          </Section>
        ) : null}

        <Section {...sections.find((s) => s.id === "connections")!}>
          {L.connections_back.length ? (
            <ul className="space-y-2">
              {L.connections_back.map((c) => (
                <li key={c.lesson} className="flex flex-wrap items-start gap-2">
                  {(() => {
                    const n = cur?.lessons.find((l) => l.id === c.lesson);
                    return n ? <NodeChip n={n} state={stateOf(c.lesson)} /> : <span>{c.lesson}</span>;
                  })()}
                  <span className="flex-1 pt-1 text-ink-2"><RichText text={c.how} inline /></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">This is the very first lesson. Everything else will connect back to it.</p>
          )}
          {data.prerequisites.length ? (
            <p className="mt-3 text-sm text-ink-3">Prerequisites in the knowledge map: {data.prerequisites.map((p) => p.title).join(", ")}.</p>
          ) : null}
        </Section>

        <Section {...sections.find((s) => s.id === "worked")!}><StepReveal ex={L.worked} /></Section>

        <Section {...sections.find((s) => s.id === "experiment")!}>
          <Card>
            <p className="mb-3 font-medium"><RichText text={L.experiment.task} inline /></p>
            <Widget widget={L.experiment.widget} props={L.experiment.props} goal={L.experiment.goal} onComplete={onExperimentDone} />
            {experimentDone ? (
              <div className="mt-3 rounded-lg bg-good-soft px-3 py-2 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-good"><Check size={15} /> Experiment complete</p>
                <RichText text={L.experiment.success} />
              </div>
            ) : null}
          </Card>
        </Section>

        <Section {...sections.find((s) => s.id === "mistakes")!}>
          <div className="space-y-3">
            {L.mistakes.map((m, i) => (
              <Card key={i}>
                <p className="flex items-start gap-2 font-semibold"><X size={18} className="mt-0.5 shrink-0 text-bad" /><RichText text={m.mistake} inline /></p>
                <p className="mt-2 text-sm"><span className="font-semibold text-ink-2">Why it is wrong: </span><RichText text={m.why} inline /></p>
                <p className="mt-1 text-sm"><span className="font-semibold text-good">Instead: </span><RichText text={m.fix} inline /></p>
              </Card>
            ))}
          </div>
        </Section>

        {L.statements.length ? (
          <Section {...sections.find((s) => s.id === "statements")!}>
            <p className="mb-3 text-sm text-ink-2">Mathematics is careful about the status of every claim. Each statement in this lesson is labelled.</p>
            <StatementList items={L.statements} />
            <KindLegend />
          </Section>
        ) : null}

        <Section {...sections.find((s) => s.id === "assessment")!}>
          <Card>
            <Assessment key={assessRun?.key ?? 0} lessonId={id} passScore={L.assessment.pass_score} count={L.assessment.question_count}
              mode={assessRun?.mode ?? "lesson"} autoStart={!!assessRun} onFailed={() => setConfused(true)} />
          </Card>
          {L.practice.length ? (
            <div className="mt-6">
              <h3 className="mb-2 font-semibold">Practise more</h3>
              <PracticePanel generators={L.practice} lessonId={id} />
            </div>
          ) : null}
        </Section>

        <Section {...sections.find((s) => s.id === "forward")!}>
          <ul className="space-y-2">
            {L.connections_forward.map((c) => {
              const n = cur?.lessons.find((l) => l.id === c.lesson);
              return (
                <li key={c.lesson} className="flex flex-wrap items-start gap-2">
                  {n ? <NodeChip n={n} state={stateOf(n.id)} /> : <span>{c.lesson}</span>}
                  <span className="flex-1 pt-1 text-ink-2"><RichText text={c.how} inline /></span>
                </li>
              );
            })}
          </ul>
          {data.unlocks.length ? (
            <p className="mt-4 text-sm text-ink-3">Understanding this lesson opens the way to: {data.unlocks.map((u) => u.title).join(", ")}.</p>
          ) : null}
        </Section>
      </article>

      {/* ------------------------------------------------------------------ sidebar */}
      <aside className="hidden lg:block">
        <nav className="sticky top-8 space-y-0.5 text-sm" aria-label="Lesson sections">
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">In this lesson</p>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}
              className={`flex items-center gap-2 rounded px-2 py-1 ${current === s.id ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink"}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${viewed.has(s.id) ? "bg-good" : "bg-line"}`} />
              {s.title}
            </a>
          ))}
        </nav>
      </aside>

      {/* ------------------------------------------------------------------ floating help */}
      <div className="fixed right-4 bottom-4 z-30 flex flex-col items-end gap-2">
        <button type="button" onClick={() => setConfused(true)}
          className="flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-card hover:opacity-90">
          <HelpCircle size={18} /> I don&apos;t understand
        </button>
      </div>

      {confused ? (
        <DontUnderstand lessonId={id} section={current} prerequisites={data.prerequisites} initialSeen={seenStrategies}
          onSeen={(s) => { setSeenStrategies(s); storageSet(`seen-strategies:${id}`, s); }}
          onClose={() => setConfused(false)} onAskTutor={() => { setConfused(false); setTutorOpen(true); }} />
      ) : null}

      {tutorOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Tutor">
          <button type="button" aria-label="Close tutor" className="absolute inset-0 bg-black/25" onClick={() => setTutorOpen(false)} />
          <div className="relative flex h-full w-full max-w-lg flex-col border-l border-line bg-bg p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold">Tutor · {data.node.title}</p>
                {sectionTitle ? <p className="text-xs text-ink-3">The tutor knows you are on: {sectionTitle}</p> : null}
              </div>
              <button type="button" onClick={() => setTutorOpen(false)} className="rounded p-1 hover:bg-surface-2" aria-label="Close"><X size={18} /></button>
            </div>
            <TutorChat threadId={threadId} onThread={(t) => { setThreadId(t); storageSet(`tutor-thread:${id}`, t); }} lessonId={id} section={current} compact />
          </div>
        </div>
      ) : null}
    </div>
  );
}
