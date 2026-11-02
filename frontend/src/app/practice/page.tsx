"use client";

import Link from "next/link";
import { useCurriculum, useGenerators, useProgress } from "@/lib/api";
import { PracticePanel } from "@/components/lesson/PracticePanel";
import { Card, ErrorNote, Loading } from "@/components/ui";

export default function Practice() {
  const { data: gens, error } = useGenerators();
  const { data: cur } = useCurriculum();
  const { data: prog } = useProgress();
  if (error) return <ErrorNote error={error} />;
  if (!gens || !cur) return <Loading />;
  const byLesson = new Map<string, string[]>();
  for (const g of gens) byLesson.set(g.lesson, [...(byLesson.get(g.lesson) ?? []), g.id]);
  const order = cur.lessons.map((l) => l.id).filter((id) => byLesson.has(id));
  const known = (id: string) => ["understood", "mastered", "introduced", "needs_revision"].includes(prog?.states[id]?.state ?? "");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">Practice</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Fresh questions every time, with answers computed and checked exactly by the computer - never written by hand. Practice the ideas from
          lessons you have started; the rest are here too, if you are curious.
        </p>
      </header>
      {order.map((lid) => {
        const n = cur.lessons.find((l) => l.id === lid)!;
        return (
          <Card key={lid} className={known(lid) ? "" : "opacity-80"}>
            <p className="mb-2 font-semibold">
              <Link href={`/learn/${lid}`} className="hover:underline">{n.title}</Link>
              {!known(lid) ? <span className="ml-2 text-xs font-normal text-ink-3">lesson not started yet</span> : null}
            </p>
            <PracticePanel generators={byLesson.get(lid)!} lessonId={lid} />
          </Card>
        );
      })}
    </div>
  );
}
