import { useEffect, useState } from "react";
import { ExternalLink, FileText, Link2, Mail, Star } from "lucide-react";
import { CareerOpsPanel } from "@/components/CareerOpsPanel";
import type { Job, Tracking } from "@shared/types";
import type { Row } from "@/hooks/use-app-data";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { sanitize } from "@/lib/sanitize";
import { ago, EligibilityBadge, ScoreBreakdownView, StatusSelect } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  row: Row | null;
  onClose: () => void;
  onTrack: (jobId: string, patch: Partial<Tracking> & { note?: string }) => void;
  onApply: (row: Row, mode: "link" | "email") => void;
  careerOps: boolean;
  onOpenRun: (runId: string) => void;
}

export function JobSheet({ row, onClose, onTrack, onApply, careerOps, onOpenRun }: Props) {
  const [full, setFull] = useState<Job | null>(null);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setFull(null);
    if (!row) return;
    setNotes(row.tracking?.notes || "");
    api.job(row.job.id).then(setFull).catch(() => setFull(null));
  }, [row?.job.id]); // eslint-disable-line react-hooks/exhaustive-deps


  if (!row) return null;
  const { job, score, resume } = row;
  const status = row.tracking?.status ?? "New";

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>#{row.rank}</span>
            <span>·</span>
            <span>{job.source}</span>
            <span>·</span>
            <span>posted {ago(score.daysOld)} ago</span>
            {job.status === "gone" && <Badge variant="destructive">Removed from site</Badge>}
          </div>
          <SheetTitle className="text-xl leading-tight">{job.title}</SheetTitle>
          <SheetDescription className="text-base">{job.company}</SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <EligibilityBadge e={score.eligibility} reason={score.eligibilityReason} />
            <Badge variant="outline">{score.focus}</Badge>
            {job.location && <Badge variant="outline" className="max-w-full truncate" title={job.location}>{job.location}</Badge>}
            {job.workFormat.map((w) => (
              <Badge key={w} variant="secondary">
                {w}
              </Badge>
            ))}
            {job.jobType && <Badge variant="outline">{job.jobType}</Badge>}
          </div>
        </SheetHeader>

        <div className="grid gap-5 px-5 pb-8">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => onApply(row, "link")}>
              <Link2 /> Apply via link
            </Button>
            <Button variant="outline" onClick={() => onApply(row, "email")}>
              <Mail /> Apply by email{job.emails.length ? "" : " (no address found)"}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onTrack(job.id, { starred: !row.tracking?.starred })} title="Star">
              <Star className={cn(row.tracking?.starred && "fill-amber-400 text-amber-400")} />
            </Button>
            <StatusSelect value={status} onChange={(s) => onTrack(job.id, { status: s })} className="ml-auto" />
          </div>

          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{score.total.toFixed(0)}</span>
                <span className="text-muted-foreground text-sm">/ 100 · tier {score.tier}</span>
              </div>
              <ScoreBreakdownView s={score} />
            </div>
            <div className="grid content-start gap-3 text-sm">
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">Suggested resume</div>
                <div className="flex items-center gap-2 font-medium">
                  <FileText className="size-4" /> {resume.resume?.label ?? "—"}
                </div>
                <div className="text-muted-foreground text-xs">{resume.reason}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">Salary</div>
                {job.salaryText || "Not listed"}
              </div>
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">Experience asked</div>
                {job.minYears != null ? `${job.minYears}+ years` : "Not stated"}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-medium">Skills</div>
            <div className="flex flex-wrap gap-1.5">
              {score.matchedSkills.map((s) => (
                <Badge key={s} variant="success">
                  {s}
                </Badge>
              ))}
              {score.missingSkills.map((s) => (
                <Badge key={s} variant="outline" className="text-muted-foreground">
                  {s}
                </Badge>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">Green = on your resume. Grey = not on your resume (only add it if you've actually used it).</p>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-medium">Notes</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (row.tracking?.notes || "") && onTrack(job.id, { notes })}
              placeholder="Recruiter name, referral, follow-up date…"
            />
            {row.tracking?.history.length ? (
              <div className="text-muted-foreground grid gap-0.5 text-xs">
                {row.tracking.history.map((h, i) => (
                  <div key={i}>
                    {new Date(h.at).toLocaleString()} — {h.status}
                    {h.note ? ` · ${h.note}` : ""}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {careerOps && <CareerOpsPanel job={job} tracking={row.tracking} onOpenRun={onOpenRun} />}

          <Separator />
          {job.whoFor && (
            <div className="grid gap-1">
              <div className="text-sm font-medium">Who is this job for?</div>
              <p className="text-muted-foreground text-sm">{job.whoFor}</p>
            </div>
          )}
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Job description</div>
              <Button variant="link" size="sm" asChild>
                <a href={job.url} target="_blank" rel="noreferrer">
                  Open original <ExternalLink />
                </a>
              </Button>
            </div>
            {full?.descriptionHtml ? (
              <div className="prose-job text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitize(full.descriptionHtml) }} />
            ) : (
              <p className="text-sm whitespace-pre-line">{job.descriptionText}</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
