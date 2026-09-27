import { useMemo } from "react";
import { marked } from "marked";
import { sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

/** Renders career-ops markdown (reports, drafts) safely. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => sanitize(marked.parse(text, { async: false, gfm: true }) as string), [text]);
  return <div className={cn("prose-md text-sm leading-relaxed", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
