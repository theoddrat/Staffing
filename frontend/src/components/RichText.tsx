"use client";

import Link from "next/link";
import { Fragment, useMemo, type ReactNode } from "react";
import { autoLink, parseBlocks, parseInline, type Block, type Inline } from "@/lib/richtext";
import { Tex } from "./Tex";
import { useTerms } from "./TermContext";

type Props = {
  text: string;
  /** render a single line without paragraph wrappers */
  inline?: boolean;
  /** automatically link dictionary words (default true) */
  link?: boolean;
  className?: string;
};

/** Lesson-content markup: math, dictionary links, lesson links, emphasis, lists. */
export function RichText({ text, inline = false, link = true, className }: Props) {
  const { index, openTerm, terms } = useTerms();
  const blocks: Block[] = useMemo(() => {
    const linked = new Set<string>();
    const al = (nodes: Inline[]) => (link ? autoLink(nodes, index, linked) : nodes);
    if (inline) return [{ type: "p", children: al(parseInline(text.trim())) }];
    return parseBlocks(text).map((b): Block => {
      switch (b.type) {
        case "p":
        case "h3":
          return { ...b, children: al(b.children) };
        case "ul":
        case "ol":
          return { ...b, items: b.items.map(al) };
        default:
          return b;
      }
    });
  }, [text, inline, link, index]);

  const renderInline = (nodes: Inline[]): ReactNode =>
    nodes.map((n, i) => {
      switch (n.type) {
        case "text":
          return <Fragment key={i}>{n.text}</Fragment>;
        case "math":
          return <Tex key={i} tex={n.tex} display={n.display} />;
        case "bold":
          return <strong key={i} className="font-semibold">{renderInline(n.children)}</strong>;
        case "italic":
          return <em key={i}>{renderInline(n.children)}</em>;
        case "term": {
          const known = terms.get(n.id);
          if (!known && terms.size > 0) return <Fragment key={i}>{n.label}</Fragment>;
          return (
            <button
              key={i}
              type="button"
              className="term-link"
              title={known ? `${known.word}: ${known.plain}` : "Open in the dictionary"}
              onClick={() => openTerm(n.id)}
            >
              {n.label}
            </button>
          );
        }
        case "lesson":
          return (
            <Link key={i} href={`/learn/${n.id}`} className="text-accent underline underline-offset-2">
              {n.label}
            </Link>
          );
      }
    });

  if (inline) {
    const b = blocks[0];
    return <span className={className}>{b && b.type === "p" ? renderInline(b.children) : null}</span>;
  }
  return (
    <div className={`prose-math ${className ?? ""}`}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "p":
            return <p key={i}>{renderInline(b.children)}</p>;
          case "h3":
            return <h3 key={i}>{renderInline(b.children)}</h3>;
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case "math":
            return <Tex key={i} tex={b.tex} display />;
        }
      })}
    </div>
  );
}
