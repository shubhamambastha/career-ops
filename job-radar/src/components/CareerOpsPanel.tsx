import { useEffect, useState } from "react";
import { Activity, Loader2, ScanSearch, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Job, Tracking } from "@shared/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Gap = Awaited<ReturnType<typeof api.skillGap>>;
const itemText = (x: unknown) => (typeof x === "string" ? x : ((x as Record<string, unknown>)?.skill as string) || ((x as Record<string, unknown>)?.name as string) || JSON.stringify(x));

const QUICK: Array<{ mode: string; label: string }> = [
  { mode: "auto-pipeline", label: "Evaluate + tailor CV" },
  { mode: "triage", label: "Quick triage" },
  { mode: "cover", label: "Cover letter" },
  { mode: "email", label: "Application email" },
  { mode: "contacto", label: "LinkedIn outreach" },
  { mode: "deep", label: "Company research" },
  { mode: "interview-prep", label: "Interview prep" },
];

/** career-ops actions for one job: AI modes, zero-LLM skill-gap + liveness checks, pipeline. */
export function CareerOpsPanel({ job, tracking, onOpenRun }: { job: Job; tracking?: Tracking; onOpenRun: (runId: string) => void }) {
  const [gap, setGap] = useState<Gap | null>(null);
  const [gapBusy, setGapBusy] = useState(false);
  const [live, setLive] = useState<{ verdict: string; output: string } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  useEffect(() => {
    setGap(null);
    setLive(null);
  }, [job.id]);

  const run = async (mode: string) => {
    try {
      const r = await api.startRun({ kind: "ai", mode, jobId: job.id });
      toast.success("Started in AI Studio");
      onOpenRun(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4" /> career-ops
        {tracking?.careerOpsRow && (
          <Badge variant="outline" className="ml-auto">
            tracker row #{tracking.careerOpsRow}
          </Badge>
        )}
      </div>

      <div className="grid gap-1.5">
        <div className="text-muted-foreground text-xs">AI (Claude Code, runs in the background)</div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <Button key={q.mode} size="sm" variant="outline" onClick={() => run(q.mode)}>
              {q.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="text-muted-foreground text-xs">Instant checks (no AI)</div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={gapBusy}
            onClick={async () => {
              setGapBusy(true);
              setGap(await api.skillGap(job.id).catch((e) => (toast.error(e.message), null)));
              setGapBusy(false);
            }}
          >
            {gapBusy ? <Loader2 className="animate-spin" /> : <ScanSearch />} Skill gap vs cv.md
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={liveBusy}
            onClick={async () => {
              setLiveBusy(true);
              setLive(await api.liveness(job.id).catch((e) => (toast.error(e.message), null)));
              setLiveBusy(false);
            }}
          >
            {liveBusy ? <Loader2 className="animate-spin" /> : <Activity />} Is it still live?
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await api.addToPipeline(job.url).catch((e: Error) => (toast.error(e.message), null));
              if (r) toast.success(r.added ? "Added to data/pipeline.md" : "Already in pipeline.md");
            }}
          >
            <Send /> Add to pipeline
          </Button>
        </div>
      </div>

      {gap && (
        <div className="grid gap-2 text-sm">
          {gap.lowConfidence && <p className="text-muted-foreground bg-muted/50 rounded-md p-2 text-xs">{gap.lowConfidence.message}</p>}
          {(
            [
              ["existing", "In your Skills section", "success"],
              ["supportedByResume", "Mentioned in your CV text", "secondary"],
              ["gap", "Not in your CV — real gap", "destructive"],
            ] as const
          ).map(([k, label, variant]) =>
            (gap[k] as unknown[] | undefined)?.length ? (
              <div key={k} className="grid gap-1">
                <div className="text-muted-foreground text-xs">{label}</div>
                <div className="flex flex-wrap gap-1">
                  {(gap[k] as unknown[]).map((x, i) => (
                    <Badge key={i} variant={variant}>
                      {itemText(x)}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}

      {live && (
        <div className="grid gap-1 text-sm">
          <div>
            Posting:{" "}
            <Badge variant={live.verdict === "active" ? "success" : live.verdict === "expired" ? "destructive" : "warning"}>{live.verdict}</Badge>
          </div>
          <details className="text-xs">
            <summary className="text-muted-foreground cursor-pointer">check-liveness output</summary>
            <pre className="bg-muted mt-1 max-h-40 overflow-auto rounded p-2 whitespace-pre-wrap">{live.output}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
