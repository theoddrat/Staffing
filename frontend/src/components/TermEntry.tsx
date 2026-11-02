"use client";

import Link from "next/link";
import { Volume2 } from "lucide-react";
import type { TermOut } from "@/lib/types";
import { Tex } from "./Tex";
import { RichText } from "./RichText";
import { KindBadge } from "./Statements";
import { useTerms } from "./TermContext";
import { Widget } from "@/widgets/registry";

function speak(word: string) {
  try {
    const u = new SpeechSynthesisUtterance(word);
    u.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is optional */
  }
}

function Field({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">
        <span className="mr-1 text-ink-3/70">{n}.</span>
        {label}
      </h3>
      {children}
    </section>
  );
}

/** A full dictionary entry with all ten parts. */
export function TermEntry({ data, compact = false }: { data: TermOut; compact?: boolean }) {
  const t = data.term;
  const { openTerm, terms } = useTerms();
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  return (
    <article className="space-y-3">
      <header>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className={`${compact ? "text-2xl" : "text-3xl"} font-serif font-semibold`}>{t.word}</h2>
          {t.symbol ? (
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-lg" aria-label="symbol">
              <Tex tex={t.symbol} />
            </span>
          ) : null}
        </div>
        <Field n={2} label="How to say it">
          <p className="flex items-center gap-2 text-ink-2">
            <span>{t.pronunciation}</span>
            {canSpeak ? (
              <button type="button" onClick={() => speak(t.word.split(" (")[0])} className="rounded p-1 hover:bg-surface-2"
                aria-label={`Hear the word ${t.word}`}>
                <Volume2 size={16} />
              </button>
            ) : null}
          </p>
        </Field>
      </header>
      <Field n={3} label="In plain words">
        <RichText text={t.plain} link={false} />
      </Field>
      <Field n={4} label="Everyday analogy">
        <RichText text={t.analogy} link={false} />
      </Field>
      <Field n={5} label="Picture it">
        <div className="rounded-lg border border-line bg-surface-2/50 p-2">
          <Widget widget={t.visual.widget} props={t.visual.props} compact />
        </div>
        <p className="mt-1 text-sm text-ink-2">
          <RichText text={t.visual.caption} inline link={false} />
        </p>
      </Field>
      <Field n={6} label="Precise definition">
        <div className="mb-1"><KindBadge kind={t.formal_kind ?? "definition"} /></div>
        <RichText text={t.formal} link={false} />
      </Field>
      <Field n={7} label="Example">
        <RichText text={t.example} link={false} />
      </Field>
      <Field n={8} label="Non-example (something it is not)">
        <RichText text={t.non_example} link={false} />
      </Field>
      <Field n={9} label="Related words">
        <div className="flex flex-wrap gap-2">
          {(t.related ?? []).map((r) => (
            <button key={r} type="button" onClick={() => openTerm(r)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-sm hover:border-accent">
              {terms.get(r)?.word ?? r}
            </button>
          ))}
        </div>
      </Field>
      <Field n={10} label="Where you will use it">
        <ul className="space-y-1 text-sm">
          {t.used_later.map((u) => (
            <li key={u.lesson}>
              <Link href={`/learn/${u.lesson}`} className="font-medium text-accent hover:underline">{u.lesson}</Link>
              <span className="text-ink-2"> - <RichText text={u.how} inline link={false} /></span>
            </li>
          ))}
        </ul>
      </Field>
      <p className="border-t border-line pt-3 text-sm text-ink-3">
        First taught in{" "}
        <Link href={`/learn/${data.introduced_in.id}`} className="text-accent hover:underline">
          {data.introduced_in.title}
        </Link>
        {data.state.seen ? " · in your dictionary" : ""}
        {data.state.learned ? " · learned" : ""}
      </p>
    </article>
  );
}
