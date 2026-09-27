import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, FileText, Loader2, Square, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { RunEvent, RunInfo } from "@shared/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RunStatusBadge({ status }: { status: RunInfo["status"] }) {
  const map = {
    queued: { v: "secondary" as const, icon: <CircleDashed />, label: "Queued" },
    running: { v: "warning" as const, icon: <Loader2 className="animate-spin" />, label: "Running" },
    done: { v: "success" as const, icon: <CheckCircle2 />, label: "Done" },
    failed: { v: "destructive" as const, icon: <XCircle />, label: "Failed" },
    cancelled: { v: "outline" as const, icon: <Square />, label: "Cancelled" },
  }[status];
  return (
    <Badge variant={map.v}>
      {map.icon}
      {map.label}
    </Badge>
  );
}

function duration(r: RunInfo) {
  if (!r.startedAt) return "";
  const ms = new Date(r.finishedAt || Date.now()).getTime() - new Date(r.startedAt).getTime();
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Opens a career-ops file: markdown/text in a dialog, PDFs and others in a new tab. */
export function FileOpener({ path, className }: { path: string; className?: string }) {
  const [doc, setDoc] = useState<{ path: string; content: string } | null>(null);
  const isText = /\.(md|txt|tsv|json|log|yml)$/i.test(path);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("justify-start font-mono text-xs", className)}
        onClick={async () => {
          if (!isText) return window.open(api.coFileUrl(path), "_blank", "noopener");
          try {
            setDoc(await api.coFile(path));
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        {isText ? <FileText /> : <ExternalLink />}
        <span className="truncate">{path}</span>
      </Button>
      <Dialog open={!!doc} onOpenChange={(o) => !o && setDoc(null)}>
        <DialogContent className="max-h-[88vh] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{doc?.path}</DialogTitle>
          </DialogHeader>
          {doc && (/\.md$/i.test(doc.path) ? <Markdown text={doc.content} /> : <pre className="bg-muted overflow-auto rounded-md p-3 text-xs">{doc.content}</pre>)}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EventLine({ e }: { e: RunEvent }) {
  if (e.kind === "text") return <Markdown text={e.text} className="border-l-2 border-sky-500/40 pl-3" />;
  if (e.kind === "tool")
    return (
      <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
        <Wrench className="size-3 shrink-0" /> <span className="truncate">{e.text}</span>
      </div>
    );
  if (e.kind === "error")
    return (
      <div className="text-destructive flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="whitespace-pre-wrap">{e.text}</span>
      </div>
    );
  if (e.kind === "result") return null;
  return <div className="text-muted-foreground font-mono text-xs whitespace-pre-wrap">{e.text}</div>;
}

export function RunViewer({ runId, onChanged }: { runId: string; onChanged?: () => void }) {
  const [run, setRun] = useState<(RunInfo & { events: RunEvent[] }) | null>(null);
  const [showLog, setShowLog] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const prevStatus = useRef<string>("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await api.run(runId).catch(() => null);
      if (!alive) return;
      if (r) {
        setRun(r);
        if (prevStatus.current && prevStatus.current !== r.status) onChanged?.();
        prevStatus.current = r.status;
      }
      if (!r || r.status === "running" || r.status === "queued") timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, onChanged]);

  useEffect(() => {
    if (run?.status === "running") bottom.current?.scrollIntoView({ block: "nearest" });
  }, [run?.events.length, run?.status]);

  if (!run) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const visible = run.events.filter((e) => showLog || e.kind !== "log");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{run.title}</div>
          <div className="text-muted-foreground text-xs">
            {new Date(run.createdAt).toLocaleString()} · {run.kind === "ai" ? `career-ops ${run.mode}` : run.mode}
            {duration(run) && ` · ${duration(run)}`}
            {run.costUsd != null && ` · $${run.costUsd.toFixed(2)}`}
          </div>
        </div>
        <RunStatusBadge status={run.status} />
        {(run.status === "running" || run.status === "queued") && (
          <Button size="sm" variant="outline" onClick={() => api.cancelRun(run.id).then(onChanged)}>
            <Square /> Stop
          </Button>
        )}
      </div>

      {run.outputs.length > 0 && (
        <div className="grid gap-2 rounded-lg border p-3">
          <div className="text-sm font-medium">Files created or changed</div>
          <div className="grid gap-1.5">
            {run.outputs.map((f) => (
              <FileOpener key={f} path={f} />
            ))}
          </div>
          {run.outputs.some((f) => f.startsWith("output/") && f.endsWith(".pdf")) && (
            <p className="text-muted-foreground text-xs">Tailored PDFs in output/ appear in the resume picker when you apply.</p>
          )}
        </div>
      )}

      {run.result && run.status !== "running" && (
        <div className="bg-muted/40 rounded-lg border p-4">
          <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">Result</div>
          <Markdown text={run.result} />
        </div>
      )}

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Activity</div>
          <Button variant="ghost" size="sm" onClick={() => setShowLog(!showLog)}>
            {showLog ? "Hide raw log" : "Show raw log"}
          </Button>
        </div>
        <div className="grid max-h-[55vh] gap-2 overflow-y-auto rounded-lg border p-3">
          {visible.length === 0 && <p className="text-muted-foreground text-sm">{run.status === "queued" ? "Waiting for the previous run to finish…" : "No activity yet."}</p>}
          {visible.map((e, i) => (
            <EventLine key={i} e={e} />
          ))}
          {run.status === "running" && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3 animate-spin" /> working…
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      {run.prompt && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">Prompt sent to Claude</summary>
          <pre className="bg-muted mt-2 overflow-auto rounded-md p-3 whitespace-pre-wrap">{run.prompt}</pre>
        </details>
      )}
    </div>
  );
}
