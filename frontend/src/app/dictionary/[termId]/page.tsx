"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { api, useTerm } from "@/lib/api";
import { TermEntry } from "@/components/TermEntry";
import { Card, ErrorNote, Loading } from "@/components/ui";

export default function TermPage() {
  const { termId } = useParams<{ termId: string }>();
  const { data, error } = useTerm(termId);
  useEffect(() => {
    api.termViewed(termId).catch(() => {});
  }, [termId]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/dictionary" className="text-sm text-accent hover:underline">← My dictionary</Link>
      {error ? <ErrorNote error={error} /> : !data ? <Loading /> : <Card><TermEntry data={data} /></Card>}
    </div>
  );
}
