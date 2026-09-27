import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, Mail, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { renderTemplate } from "@shared/scoring";
import type { Settings } from "@shared/types";
import type { Row } from "@/hooks/use-app-data";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ApplyMode = "link" | "email";

interface Props {
  row: Row | null;
  mode: ApplyMode;
  settings: Settings;
  onOpenChange: (open: boolean) => void;
  onApplied: (method: ApplyMode, resumeId: string, note?: string) => void;
}

/**
 * Draft-only apply flow: opens the job page or a pre-filled email draft.
 * Nothing is sent or submitted by the app — you confirm afterwards and it is tracked as Applied.
 */
export function ApplyDialog({ row, mode, settings, onOpenChange, onApplied }: Props) {
  const [resumeId, setResumeId] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [opened, setOpened] = useState(false);
  const [tailored, setTailored] = useState<Array<{ file: string; name: string; report?: string }>>([]);
  const [jobReport, setJobReport] = useState<string | null>(null);
  const [filling, setFilling] = useState<string | null>(null);
  const [fillResult, setFillResult] = useState<Awaited<ReturnType<typeof api.autofill>> | null>(null);

  const resume = settings.resumes.find((r) => r.id === resumeId);

  const vars = useMemo((): Record<string, string | number> => {
    if (!row) return {};
    const p = settings.profile;
    return {
      title: row.job.title,
      company: row.job.company || "Hiring",
      source: row.job.source,
      url: row.job.url,
      name: p.name,
      email: p.email,
      phone: p.phone,
      linkedin: p.linkedin,
      portfolio: p.portfolio,
      location: p.location,
      years: settings.scoring.seniority.myYears,
      matchedSkills: row.score.matchedSkills.slice(0, 6).join(", ") || "full-stack JavaScript",
      resumeLabel: resume?.label ?? "",
    };
  }, [row, settings, resume]);

  useEffect(() => {
    if (!row) return;
    setResumeId(row.tracking?.resumeId || row.resume.resume?.id || settings.resumes[0]?.id || "");
    setTo(row.job.emails[0] || "");
    setOpened(false);
    setJobReport(null);
    setFillResult(null);
    // Tailored CVs career-ops generated (output/), and which one belongs to this job's evaluation report.
    Promise.all([api.resumes(), row.tracking?.careerOpsRow ? api.tracker().catch(() => null) : Promise.resolve(null)])
      .then(([r, t]) => {
        setTailored(r.tailored);
        const report = t?.rows.find((x) => x.num === row.tracking?.careerOpsRow)?.reportNum ?? null;
        setJobReport(report);
        const mine = report && r.tailored.find((x) => x.report === report);
        if (mine && !row.tracking?.resumeId) setResumeId(`output:${mine.file}`);
      })
      .catch(() => setTailored([]));
  }, [row, settings.resumes]);

  useEffect(() => {
    if (!row) return;
    setSubject(renderTemplate(settings.email.subject, vars));
    setBody(renderTemplate(settings.email.body, vars));
  }, [row, settings.email, vars]);

  if (!row) return null;
  const links = [...row.job.applyLinks, row.job.url];

  const openDraft = () => {
    const url =
      settings.email.client === "gmail"
        ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        : `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    setOpened(true);
    toast.info(`Attach "${resumeId.startsWith("output:") ? resumeId.split("/").pop() : resume?.file ?? "your resume"}" before sending.`);
  };

  const openLink = (href: string) => {
    window.open(href, "_blank", "noopener");
    setOpened(true);
  };

  const autoFill = async (href: string) => {
    setFilling(href);
    setFillResult(null);
    try {
      const r = await api.autofill({ jobId: row.job.id, resumeId, url: href });
      setFillResult(r);
      if (r.loginRequired) return void toast.info("That page wants you to sign in first — do it in the browser window, then click Auto-fill again.");
      setOpened(true);
      toast.success(`Filled ${r.filled.length} field(s) in the browser window — review and submit there.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFilling(null);
    }
  };

  const resumeHref = resumeId.startsWith("output:") ? api.coFileUrl(resumeId.slice(7)) : api.resumeUrl(resumeId);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "email" ? "Apply by email" : "Apply via link"}</DialogTitle>
          <DialogDescription>
            {row.job.title} · {row.job.company}. Nothing is sent automatically — you review and submit, then mark it applied here.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Resume to use</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={resumeId} onValueChange={setResumeId}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Choose a resume" />
              </SelectTrigger>
              <SelectContent>
                {settings.resumes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                    {r.id === row.resume.resume?.id ? " (suggested)" : ""}
                  </SelectItem>
                ))}
                {tailored.map((t) => (
                  <SelectItem key={t.file} value={`output:${t.file}`}>
                    Tailored: {t.name}
                    {jobReport && t.report === jobReport ? " (for this job)" : t.report ? ` (report ${t.report})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" asChild>
              <a href={resumeHref} target="_blank" rel="noreferrer" download>
                <Download /> Download
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">Suggested: {row.resume.resume?.label ?? "—"} — {row.resume.reason}</p>
        </div>

        {mode === "email" ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recruiter@company.com" />
              {!row.job.emails.length && <p className="text-muted-foreground text-xs">No email found in the posting — add the recruiter's address if you have it.</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-56 font-mono text-xs" />
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label>Where to apply</Label>
            {links.map((href) => (
              <div key={href} className="flex min-w-0 gap-2">
                <Button variant="outline" className="min-w-0 flex-1 justify-start" onClick={() => openLink(href)}>
                  <ExternalLink /> <span className="truncate">{href}</span>
                </Button>
                <Button variant="secondary" onClick={() => autoFill(href)} disabled={!!filling} title="Open in a browser window, fill your details and upload the resume. You submit.">
                  {filling === href ? <Loader2 className="animate-spin" /> : <Wand2 />} Auto-fill
                </Button>
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              Auto-fill opens the form in a separate browser window, fills your contact details from profile.yml and uploads the resume above. It never presses Submit.
            </p>
            {fillResult?.loginRequired && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <span className="font-medium">Sign in first.</span> The page in the Job Radar browser window is a sign-in page. Sign in there yourself (Google, Bitwarden and 2FA all
                work); the window remembers it. Then click Auto-fill again. Nothing was filled.
              </div>
            )}
            {fillResult && !fillResult.loginRequired && (
              <div className="bg-muted/50 grid gap-1 rounded-md p-3 text-xs">
                <div className="font-medium">
                  Filled {fillResult.filled.length} field(s){fillResult.resumeUploaded ? ", resume uploaded" : ", no resume upload found"}.
                </div>
                {fillResult.filled.length > 0 && <div className="text-muted-foreground">{fillResult.filled.map((f) => f.label).join(" · ")}</div>}
                {fillResult.needsYou.length > 0 && (
                  <div>
                    <span className="font-medium text-amber-600 dark:text-amber-400">Still needs you:</span> {fillResult.needsYou.join(" · ")}. Tip: AI Studio → "Application form answers" drafts these.
                  </div>
                )}
                <div className="text-muted-foreground">Review everything in that window and submit there, then click "Mark as applied".</div>
              </div>
            )}
            {row.job.source === "jsgurujobs" && (
              <p className="text-muted-foreground text-xs">jsgurujobs asks you to log in on the job page before its Apply button works.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {mode === "email" && (
            <Button variant="outline" onClick={openDraft} disabled={!to}>
              <Mail /> Open {settings.email.client === "gmail" ? "Gmail" : "mail app"} draft
            </Button>
          )}
          <Button
            onClick={() => {
              onApplied(mode, resumeId, mode === "email" ? `Emailed ${to}` : undefined);
              onOpenChange(false);
            }}
            variant={opened ? "default" : "secondary"}
          >
            Mark as applied
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
