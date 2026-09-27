import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Play, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AI_MODES } from "@shared/modes";
import type { RunInfo } from "@shared/types";
import type { Row } from "@/hooks/use-app-data";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RunStatusBadge, RunViewer } from "@/components/RunViewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const GROUPS = ["Evaluate", "Apply", "Research", "Interview", "Offer", "Track", "Profile"] as const;

export function JobPicker({ rows, value, onChange }: { rows: Row[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const selected = rows.find((r) => r.job.id === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => !s || `${r.job.title} ${r.job.company}`.toLowerCase().includes(s)).slice(0, 60);
  }, [rows, q]);
  return (
    <div className="grid gap-2">
      {selected && (
        <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{selected.job.title}</div>
            <div className="text-muted-foreground truncate text-xs">
              {selected.job.company} · score {selected.score.total.toFixed(0)}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange("")}>
            Change
          </Button>
        </div>
      )}
      {!selected && (
        <>
          <div className="relative">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your ranked jobs…" className="h-9 pl-8" />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {list.map((r) => (
              <button key={r.job.id} className="hover:bg-muted flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-0" onClick={() => onChange(r.job.id)}>
                <span className="text-muted-foreground w-8 shrink-0 text-xs tabular-nums">{r.score.total.toFixed(0)}</span>
                <span className="min-w-0">
                  <span className="block truncate">{r.job.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">{r.job.company}</span>
                </span>
              </button>
            ))}
            {!list.length && <p className="text-muted-foreground p-3 text-sm">No jobs match.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function AiStudio({ rows, initial, claude }: { rows: Row[]; initial: { job?: string; mode?: string; run?: string }; claude: string | null | undefined }) {
  const [mode, setMode] = useState(initial.mode && AI_MODES.some((m) => m.id === initial.mode) ? initial.mode : "auto-pipeline");
  const [jobId, setJobId] = useState(initial.job || "");
  const [company, setCompany] = useState("");
  const [extra, setExtra] = useState("");
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.run || null);
  const [busy, setBusy] = useState(false);

  const def = AI_MODES.find((m) => m.id === mode)!;
  const jobRow = rows.find((r) => r.job.id === jobId);
  const job = jobRow?.job;

  const refresh = useCallback(() => {
    api.runs().then(setRuns).catch(() => null);
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (!selected && runs[0]) setSelected(runs[0].id);
  }, [runs, selected]);

  const aiRuns = runs.filter((r) => r.kind !== "scan");

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.startRun({ kind: "ai", mode, jobId: def.needs.includes("job") || def.needs.includes("company") ? jobId || undefined : undefined, company: company || undefined, extra: extra || undefined });
      toast.success("Started — it runs in the background, you can leave this page.");
      setSelected(r.id);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canRun = (!def.needs.includes("job") || !!jobId) && (!def.needs.includes("company") || !!jobId || !!company.trim()) && (!def.input || !!extra.trim());

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-4 [&>*]:min-w-0">
        {claude === null && (
          <Card className="border-destructive/50 py-4">
            <CardContent className="flex gap-3 text-sm">
              <AlertTriangle className="text-destructive size-5 shrink-0" />
              <div>
                The <code>claude</code> CLI wasn't found. Install Claude Code (<code>npm i -g @anthropic-ai/claude-code</code>) and log in once in a terminal, or set the command in Settings →
                career-ops.
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Run a career-ops mode
            </CardTitle>
            <CardDescription>Runs headless with Claude Code inside your career-ops folder. Drafts only — nothing is sent or submitted.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3">
              {GROUPS.map((g) => (
                <div key={g} className="grid gap-1.5">
                  <div className="text-muted-foreground text-xs font-medium uppercase">{g}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {AI_MODES.filter((m) => m.group === g).map((m) => (
                      <Button key={m.id} size="sm" variant={mode === m.id ? "default" : "outline"} onClick={() => setMode(m.id)} title={m.description}>
                        {m.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground bg-muted/50 rounded-md p-2 text-xs">{def.description}</p>

            {(def.needs.includes("job") || def.needs.includes("company")) && (
              <div className="grid gap-1.5">
                <Label>Job{def.needs.includes("company") ? " (or type a company below)" : ""}</Label>
                <JobPicker rows={rows} value={jobId} onChange={setJobId} />
              </div>
            )}
            {def.needs.includes("company") && !jobId && (
              <div className="grid gap-1.5">
                <Label htmlFor="company">Company</Label>
                <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. HighLevel" />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="extra">{def.input ?? "Extra instructions (optional)"}</Label>
              <Textarea
                id="extra"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder={def.inputHint ?? "e.g. Emphasise my NestJS + AWS work; keep it under 200 words"}
                className={def.input ? "min-h-32" : "min-h-20"}
              />
            </div>
            {job && def.needs.includes("job") && <p className="text-muted-foreground text-xs">The job description is saved to career-ops jds/ so Claude can read it without logging in to the job site.</p>}
            {jobRow?.resume.resume && (mode === "auto-pipeline" || mode === "pdf") && (
              <p className="text-muted-foreground bg-muted/50 rounded-md p-2 text-xs">
                CV framing: <span className="text-foreground font-medium">{jobRow.resume.resume.label}</span> ({jobRow.resume.reason}). Built from cv.md only — change the match in
                Settings → Resumes, or override it in Extra instructions.
              </p>
            )}
            <Button onClick={start} disabled={!canRun || busy}>
              <Play /> Run {def.label}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {aiRuns.length === 0 && <p className="text-muted-foreground text-sm">No runs yet.</p>}
            {aiRuns.slice(0, 30).map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={cn("hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", selected === r.id && "bg-muted")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.title}</span>
                  <span className="text-muted-foreground block text-xs">{new Date(r.createdAt).toLocaleString()}</span>
                </span>
                <RunStatusBadge status={r.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardContent>{selected ? <RunViewer key={selected} runId={selected} onChanged={refresh} /> : <p className="text-muted-foreground text-sm">Start a run to see its progress and output here.</p>}</CardContent>
      </Card>
    </div>
  );
}
