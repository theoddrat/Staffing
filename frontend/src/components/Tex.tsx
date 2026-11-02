"use client";

import katex from "katex";
import { memo } from "react";

/** Renders LaTeX with KaTeX. Errors show the source instead of breaking the page. */
export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore", trust: false });
  } catch {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
  }
  const Tag = display ? "div" : "span";
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
