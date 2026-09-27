import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Plus, RotateCcw, Save, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Job, KeywordRule, ResumeDef, Settings, Tracking } from "@shared/types";
import { rankJobs } from "@/hooks/use-app-data";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ScrapeLog, type useScrapeStatus } from "@/components/ScrapePanel";
import { TagInput } from "@/components/TagInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxField, SwitchField } from "@/components/Fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function Num({ value, onChange, className, step = 1 }: { value: number; onChange: (n: number) => void; className?: string; step?: number }) {
  return <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={cn("h-8 w-24 tabular-nums", className)} />;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function RulesEditor({ rules, onChange }: { rules: KeywordRule[]; onChange: (r: KeywordRule[]) => void }) {
  return (
    <div className="grid gap-2">
      {rules.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_90px_auto] items-center gap-2">
          <Input value={r.label || ""} placeholder="Label" onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-8" />
          <Input value={r.pattern} placeholder="regex, e.g. \\bgraphql\\b" onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))} className="h-8 font-mono text-xs" />
          <Num value={r.points} onChange={(n) => onChange(rules.map((x, j) => (j === i ? { ...x, points: n } : x)))} className="w-full" />
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => onChange([...rules, { label: "", pattern: "", points: 5 }])}>
        <Plus /> Add rule
      </Button>
    </div>
  );
}

interface Props {
  settings: Settings;
  jobs: Job[];
  tracking: Record<string, Tracking>;
  onSave: (s: Settings) => Promise<Settings & { profileUpdated?: string[] }>;
  scrape: ReturnType<typeof useScrapeStatus>;
}

export function SettingsPage({ settings, jobs, tracking, onSave, scrape }: Props) {
  const [draft, setDraft] = useState<Settings>(() => clone(settings));
  const [resumeInfo, setResumeInfo] = useState<Awaited<ReturnType<typeof api.resumes>> | null>(null);
  const loadResumes = () => api.resumes().then(setResumeInfo).catch(() => null);
  const [careerOps, setCareerOps] = useState<Awaited<ReturnType<typeof api.careerops>> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(clone(settings)), [settings]);
  useEffect(() => {
    api.careerops().then(setCareerOps).catch(() => null);
  }, []);
  useEffect(() => {
    loadResumes();
  }, [settings.resumes]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const up = (fn: (d: Settings) => void) =>
    setDraft((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });

  // Live preview: how the top of the ranking changes with the draft settings.
  const preview = useMemo(() => {
    const before = new Map(rankJobs(jobs, tracking, settings).map((r) => [r.job.id, r.rank]));
    return rankJobs(jobs, tracking, draft)
      .filter((r) => !(draft.scoring.hideBlocked && r.score.eligibility === "blocked"))
      .slice(0, 12)
      .map((r) => ({ r, delta: (before.get(r.job.id) ?? r.rank) - r.rank }));
  }, [jobs, tracking, settings, draft]);

  const save = async () => {
    try {
      const { profileUpdated } = await onSave(draft);
      toast.success("Settings saved — jobs re-ranked", profileUpdated?.length ? { description: `Updated career-ops profile.yml: ${profileUpdated.join(", ")}` } : undefined);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sc = draft.scoring;
  const wsum = sc.weights.skills + sc.weights.location + sc.weights.seniority + sc.weights.focus + sc.weights.recency || 1;

  return (
    <div className="grid gap-4">
      <div className="bg-background/95 sticky top-14 z-10 flex items-center gap-2 border-b py-2 backdrop-blur">
        <h1 className="text-lg font-semibold">Settings</h1>
        {dirty && <Badge variant="warning">Unsaved changes</Badge>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(clone(settings))} disabled={!dirty}>
            <RotateCcw /> Discard
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty}>
            <Save /> Save
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scoring">
        <TabsList className="flex-wrap">
          <TabsTrigger value="scoring">Ranking & score</TabsTrigger>
          <TabsTrigger value="sources">Sources & scraping</TabsTrigger>
          <TabsTrigger value="resumes">Resumes</TabsTrigger>
          <TabsTrigger value="email">Email template</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="careerops">career-ops</TabsTrigger>
        </TabsList>

        {/* ---------------- Scoring ---------------- */}
        <TabsContent value="scoring" className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Weights</CardTitle>
                <CardDescription>Score = weighted average of five 0–100 components, then keyword rules add or subtract points.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {(
                  [
                    ["skills", "Skills match", "Share of the job's required stack that's on your skills list (core skills count more)."],
                    ["location", "Location / eligibility", "Can you apply from your country? Remote-eligible, relocation, unclear, blocked."],
                    ["seniority", "Seniority fit", "Years asked vs your experience, plus title rules."],
                    ["focus", "Role focus", "Backend / full-stack / frontend preference."],
                    ["recency", "Recency", "Newer postings score higher (half-life decay)."],
                  ] as const
                ).map(([k, label, hint]) => (
                  <div key={k} className="grid gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {sc.weights[k]} · {Math.round((sc.weights[k] / wsum) * 100)}%
                      </span>
                    </div>
                    <Slider value={[sc.weights[k]]} max={60} step={1} onValueChange={([v]) => up((d) => (d.scoring.weights[k] = v))} />
                    <p className="text-muted-foreground text-xs">{hint}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Your skills</CardTitle>
                <CardDescription>Only list skills you've actually used. Weight 2 = core skill you most want to be hired for.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                <div className="text-muted-foreground grid grid-cols-[160px_1fr_90px_auto] gap-2 text-xs font-medium">
                  <span>Skill</span>
                  <span>Also matches (aliases)</span>
                  <span>Weight</span>
                  <span />
                </div>
                {sc.skills.map((s, i) => (
                  <div key={i} className="grid grid-cols-[160px_1fr_90px_auto] items-center gap-2">
                    <Input value={s.name} onChange={(e) => up((d) => (d.scoring.skills[i].name = e.target.value))} className="h-8" />
                    <Input
                      value={s.aliases.join(", ")}
                      onChange={(e) =>
                        up(
                          (d) =>
                            (d.scoring.skills[i].aliases = e.target.value
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean)),
                        )
                      }
                      className="h-8 text-xs"
                    />
                    <Select value={String(s.weight)} onValueChange={(v) => up((d) => (d.scoring.skills[i].weight = Number(v)))}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0.5, 1, 1.5, 2, 3].map((w) => (
                          <SelectItem key={w} value={String(w)}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon-sm" onClick={() => up((d) => d.scoring.skills.splice(i, 1))}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-fit" onClick={() => up((d) => d.scoring.skills.push({ name: "", aliases: [], weight: 1 }))}>
                  <Plus /> Add skill
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Location & eligibility</CardTitle>
                <CardDescription>Decides whether you can apply from {sc.location.homeCountry || "your country"}.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field label="Home country">
                  <Input value={sc.location.homeCountry} onChange={(e) => up((d) => (d.scoring.location.homeCountry = e.target.value))} className="h-8 w-60" />
                </Field>
                <Field label="Cities / states in your country" hint="So on-site jobs in e.g. Bengaluru or Pune count as your country.">
                  <TagInput value={sc.location.homeAliases} onChange={(v) => up((d) => (d.scoring.location.homeAliases = v))} />
                </Field>
                <Field label="Remote regions that include you" hint='e.g. "worldwide", "APAC", "Asia". A remote job listing one of these counts as eligible.'>
                  <TagInput value={sc.location.acceptedRegions} onChange={(v) => up((d) => (d.scoring.location.acceptedRegions = v))} />
                </Field>
                <Field label="Phrases that block you" hint="If the posting says one of these and doesn't mention your country, it's marked Not eligible.">
                  <TagInput value={sc.location.blockPhrases} onChange={(v) => up((d) => (d.scoring.location.blockPhrases = v))} />
                </Field>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["remoteEligible", "Can apply"],
                      ["homeOnsite", "Relocate (on-site)"],
                      ["unclear", "Unclear"],
                      ["blocked", "Not eligible"],
                    ] as const
                  ).map(([k, l]) => (
                    <Field key={k} label={`${l} points`}>
                      <Num value={sc.location.points[k]} onChange={(n) => up((d) => (d.scoring.location.points[k] = n))} />
                    </Field>
                  ))}
                </div>
                <Field label="Max score for not-eligible jobs" hint="Keeps jobs you can't apply to out of the top tiers.">
                  <Num value={sc.location.blockedMaxScore} onChange={(n) => up((d) => (d.scoring.location.blockedMaxScore = n))} />
                </Field>
                <SwitchField label="Hide not-eligible jobs from the Jobs table" checked={sc.hideBlocked} onChange={(v) => up((d) => (d.scoring.hideBlocked = v))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Seniority</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Field label="Your years">
                    <Num value={sc.seniority.myYears} onChange={(n) => up((d) => (d.scoring.seniority.myYears = n))} />
                  </Field>
                  <Field label="Not stated → pts">
                    <Num value={sc.seniority.unknownPoints} onChange={(n) => up((d) => (d.scoring.seniority.unknownPoints = n))} />
                  </Field>
                  <Field label="−pts / year over">
                    <Num value={sc.seniority.penaltyPerYearOver} onChange={(n) => up((d) => (d.scoring.seniority.penaltyPerYearOver = n))} />
                  </Field>
                  <Field label="Too-junior gap (yrs)">
                    <Num value={sc.seniority.tooJuniorGap} onChange={(n) => up((d) => (d.scoring.seniority.tooJuniorGap = n))} />
                  </Field>
                  <Field label="Too-junior pts">
                    <Num value={sc.seniority.tooJuniorPoints} onChange={(n) => up((d) => (d.scoring.seniority.tooJuniorPoints = n))} />
                  </Field>
                </div>
                <Field label="Title rules" hint="Regex on the job title; points are added to the seniority component.">
                  <RulesEditor rules={sc.seniority.titleRules} onChange={(r) => up((d) => (d.scoring.seniority.titleRules = r))} />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Focus, recency & tiers</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["backend", "fullstack", "frontend", "other"] as const).map((k) => (
                    <Field key={k} label={`${k} pts`}>
                      <Num value={sc.focus[k]} onChange={(n) => up((d) => (d.scoring.focus[k] = n))} />
                    </Field>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Recency half-life (days)" hint="A job this old scores 50 on recency.">
                    <Num value={sc.recency.halfLifeDays} onChange={(n) => up((d) => (d.scoring.recency.halfLifeDays = n))} />
                  </Field>
                  {(["A", "B", "C"] as const).map((t) => (
                    <Field key={t} label={`Tier ${t} from`}>
                      <Num value={sc.tiers[t]} onChange={(n) => up((d) => (d.scoring.tiers[t] = n))} />
                    </Field>
                  ))}
                </div>
                <SwitchField label="Hide jobs removed from the site (unless you tracked them)" checked={sc.hideGone} onChange={(v) => up((d) => (d.scoring.hideGone = v))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Keyword boosts & penalties</CardTitle>
                <CardDescription>Regex tested on title + skills + description. Points are added to the final score.</CardDescription>
              </CardHeader>
              <CardContent>
                <RulesEditor rules={sc.keywordRules} onChange={(r) => up((d) => (d.scoring.keywordRules = r))} />
              </CardContent>
            </Card>

            <Button variant="outline" className="w-fit" onClick={() => up((d) => (d.scoring = clone(DEFAULT_SETTINGS.scoring)))}>
              <RotateCcw /> Reset scoring to defaults
            </Button>
          </div>

          <Card className="h-fit lg:sticky lg:top-28">
            <CardHeader>
              <CardTitle>Live preview</CardTitle>
              <CardDescription>Top 12 with your unsaved changes. Arrows show rank movement.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {preview.length === 0 && <p className="text-muted-foreground text-sm">No jobs yet.</p>}
              {preview.map(({ r, delta }) => (
                <div key={r.job.id} className="grid grid-cols-[24px_1fr_auto] items-center gap-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">{r.rank}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.job.title}</div>
                    <div className="text-muted-foreground truncate text-xs">{r.job.company}</div>
                  </div>
                  <div className="flex items-center gap-1 tabular-nums">
                    {delta > 0 && (
                      <span className="text-success flex items-center text-xs">
                        <ArrowUp className="size-3" />
                        {delta}
                      </span>
                    )}
                    {delta < 0 && (
                      <span className="text-destructive flex items-center text-xs">
                        <ArrowDown className="size-3" />
                        {-delta}
                      </span>
                    )}
                    <span className="font-semibold">{r.score.total.toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Sources ---------------- */}
        <TabsContent value="sources" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Job sources</CardTitle>
              <CardDescription>
                Paste any job listing link: a board (remote.com/jobs/all, jsgurujobs.com/jobs), a company careers page, or an ATS board (Greenhouse, Lever, Ashby, Workable,
                Workday and 80+ more via career-ops' providers). Job pages are read from their schema.org JobPosting data, one at a time, following robots.txt.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {draft.sources.map((s, i) => {
                const generic = !/[/.]jsgurujobs\.com(\/|$)/.test(s.url);
                return (
                  <div key={i} className="grid gap-3 rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <Switch checked={s.enabled} onCheckedChange={(v) => up((d) => (d.sources[i].enabled = v))} />
                      <Input value={s.url} onChange={(e) => up((d) => (d.sources[i].url = e.target.value))} className="h-8" />
                      <SourceKind url={s.url} />
                      <Button variant="ghost" size="icon-sm" onClick={() => up((d) => d.sources.splice(i, 1))}>
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="ID">
                        <Input value={s.id} onChange={(e) => up((d) => (d.sources[i].id = e.target.value))} className="h-8" />
                      </Field>
                      <Field label={generic ? "Max jobs per scan" : "Sweep depth"} hint={generic ? "Job pages fetched per scan, newest listed first." : "Job IDs below the newest to scan on a full scan."}>
                        <Num value={s.sweepDepth} onChange={(n) => up((d) => (d.sources[i].sweepDepth = n))} />
                      </Field>
                      <Field label="Delay (ms)" hint="Pause between requests.">
                        <Num value={s.delayMs} step={100} onChange={(n) => up((d) => (d.sources[i].delayMs = Math.max(500, n)))} />
                      </Field>
                      <Field label="Refresh after (days)">
                        <Num value={s.refreshAfterDays} onChange={(n) => up((d) => (d.sources[i].refreshAfterDays = n))} />
                      </Field>
                    </div>
                    {generic && (
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem]">
                        <Field label="Only titles containing" hint="Skip postings whose title has none of these words. Empty = fetch everything.">
                          <TagInput value={s.titleKeywords ?? []} onChange={(v) => up((d) => (d.sources[i].titleKeywords = v))} placeholder="engineer, developer, backend…" />
                        </Field>
                        <Field label="Titles not containing" hint="Skip postings whose title has any of these words. Wins over the list on the left.">
                          <TagInput value={s.titleExclude ?? []} onChange={(v) => up((d) => (d.sources[i].titleExclude = v))} placeholder="intern, sales, principal…" />
                        </Field>
                        <Field label="Listing pages" hint="?page=N pages to follow.">
                          <Num value={s.maxPages ?? 3} onChange={(n) => up((d) => (d.sources[i].maxPages = Math.max(1, n)))} />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => up((d) => d.sources.push({ id: `source-${d.sources.length + 1}`, url: "", enabled: true, sweepDepth: 50, delayMs: 1200, refreshAfterDays: 7, maxPages: 3, titleKeywords: [], titleExclude: [] }))}
              >
                <Plus /> Add source
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Scrape log</CardTitle>
              <CardDescription>Save your changes first, then use the Scrape button at the top. You can also run `npm run scrape` (add `-- --full`) from a terminal or cron.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrapeLog status={scrape.status} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Resumes ---------------- */}
        <TabsContent value="resumes" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Resumes</CardTitle>
              <CardDescription>
                For every job the app suggests the resume whose focus and keywords match best. Base resumes live in one folder shared with career-ops:{" "}
                <code>{resumeInfo?.dir ?? "…"}</code> (career-ops' <code>documents/cv/</code>, which its <code>intake</code> mode also reads). Tailored CVs career-ops generates in{" "}
                <code>output/</code> show up in the apply dialog automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {draft.resumes.map((r, i) => (
                <div key={i} className="grid gap-3 rounded-lg border p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
                    <Field label="Label">
                      <Input value={r.label} onChange={(e) => up((d) => (d.resumes[i].label = e.target.value))} className="h-8" />
                    </Field>
                    <Field label="PDF file">
                      <div className="flex items-center gap-2">
                        <Select value={r.file || "__none"} onValueChange={(v) => up((d) => (d.resumes[i].file = v === "__none" ? "" : v))}>
                          <SelectTrigger size="sm" className="w-full min-w-0">
                            <SelectValue placeholder="Choose a PDF" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— none —</SelectItem>
                            {r.file && !resumeInfo?.files.some((f) => f.file === r.file) && <SelectItem value={r.file}>{r.file} (missing)</SelectItem>}
                            {resumeInfo?.files.map((f) => (
                              <SelectItem key={f.file} value={f.file}>
                                {f.file}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {resumeInfo?.files.some((f) => f.file === r.file) ? (
                          <a href={api.resumeByNameUrl(r.file)} target="_blank" rel="noreferrer" title="Open">
                            <CheckCircle2 className="text-success size-4" />
                          </a>
                        ) : (
                          <span title="Not found in the resumes folder">
                            <XCircle className="text-destructive size-4" />
                          </span>
                        )}
                      </div>
                    </Field>
                    <div className="flex items-end gap-2">
                      <CheckboxField
                        className="h-8"
                        label="Default"
                        checked={!!r.isDefault}
                        onChange={(v) => up((d) => d.resumes.forEach((x, j) => (x.isDefault = j === i ? v : false)))}
                      />
                      <Button variant="ghost" size="icon-sm" onClick={() => up((d) => d.resumes.splice(i, 1))}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <Field label="Best for">
                    <div className="flex flex-wrap gap-4">
                      {(["backend", "fullstack", "frontend", "other"] as const).map((f) => (
                        <CheckboxField
                          key={f}
                          label={f}
                          checked={r.focus.includes(f)}
                          onChange={(v) =>
                            up((d) => {
                              const set = new Set(d.resumes[i].focus);
                              if (v) set.add(f);
                              else set.delete(f);
                              d.resumes[i].focus = [...set] as ResumeDef["focus"];
                            })
                          }
                        />
                      ))}
                    </div>
                  </Field>
                  <Field label="Keywords that favour this resume">
                    <TagInput value={r.keywords} onChange={(v) => up((d) => (d.resumes[i].keywords = v))} />
                  </Field>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => up((d) => d.resumes.push({ id: `resume-${Date.now().toString(36)}`, label: "New resume", file: "", focus: ["fullstack"], keywords: [] }))}
                >
                  <Plus /> Add resume
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { file: name } = await api.uploadResume(file);
                      await loadResumes();
                      toast.success(`Uploaded ${name} — pick it as a resume's PDF file and save.`);
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload /> Upload PDF
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Folders</CardTitle>
              <CardDescription>Both apps read the same files, so a resume you add once is available to Job Radar and to career-ops.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Base resumes folder" hint="Leave empty to use career-ops documents/cv/ (recommended). A relative path is resolved from the career-ops folder.">
                <Input value={draft.resumeFolder} placeholder="documents/cv" onChange={(e) => up((d) => (d.resumeFolder = e.target.value))} className="h-8 font-mono text-xs" />
              </Field>
              <div className="grid gap-1.5">
                <Label>Tailored CVs from career-ops (output/)</Label>
                {resumeInfo?.tailored.length ? (
                  <div className="grid gap-1">
                    {resumeInfo.tailored.slice(0, 20).map((t) => (
                      <a key={t.file} href={api.coFileUrl(t.file)} target="_blank" rel="noreferrer" className="hover:bg-muted flex items-center justify-between gap-2 rounded px-2 py-1 text-sm">
                        <span className="truncate font-mono text-xs">{t.name}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">{t.report ? `report ${t.report}` : "one-off"}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">None yet — run "Evaluate + tailor CV" or "Tailored CV" from a job.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Email ---------------- */}
        <TabsContent value="email" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Email application template</CardTitle>
              <CardDescription>
                Used to pre-fill a draft — you always review and send it yourself. Placeholders: {"{{title}} {{company}} {{source}} {{url}} {{name}} {{email}} {{phone}} {{linkedin}} {{portfolio}} {{location}} {{years}} {{matchedSkills}} {{resumeLabel}}"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Open drafts in">
                <Select value={draft.email.client} onValueChange={(v) => up((d) => (d.email.client = v as Settings["email"]["client"]))}>
                  <SelectTrigger className="w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gmail">Gmail (web compose)</SelectItem>
                    <SelectItem value="mailto">Default mail app (mailto:)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Subject">
                <Input value={draft.email.subject} onChange={(e) => up((d) => (d.email.subject = e.target.value))} />
              </Field>
              <Field label="Body">
                <Textarea value={draft.email.body} onChange={(e) => up((d) => (d.email.body = e.target.value))} className="min-h-72 font-mono text-xs" />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- career-ops ---------------- */}
        <TabsContent value="careerops" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Tracker sync</CardTitle>
              <CardDescription>
                When you mark a job Applied (and later Responded / Interview / Offer / Rejected / Discarded), mirror it into career-ops <code>data/applications.md</code>. Existing rows are
                updated with <code>set-status.mjs</code>; new rows are added as a tracker addition + <code>merge-tracker.mjs</code> (score N/A, no report).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SwitchField label="Sync statuses to the career-ops tracker" checked={draft.careerOps.syncTracker} onChange={(v) => up((d) => (d.careerOps.syncTracker = v))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>AI runner (Claude Code)</CardTitle>
              <CardDescription>AI Studio runs <code>claude -p</code> inside your career-ops folder, one job at a time.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Command" hint="Full path if claude isn't on the PATH of the terminal that starts job-radar.">
                  <Input value={draft.careerOps.claudeCommand} onChange={(e) => up((d) => (d.careerOps.claudeCommand = e.target.value))} className="h-8" />
                </Field>
                <Field label="Model (optional)" hint="Passed as --model, e.g. sonnet or opus. Empty = your Claude Code default.">
                  <Input value={draft.careerOps.model} onChange={(e) => up((d) => (d.careerOps.model = e.target.value))} className="h-8" />
                </Field>
              </div>
              <Field label="Permissions" hint="Allowlist: Claude may only use the tools below (edits auto-accepted). Bypass: --dangerously-skip-permissions, same as career-ops batch mode.">
                <Select value={draft.careerOps.permission} onValueChange={(v) => up((d) => (d.careerOps.permission = v as "allowlist" | "bypass"))}>
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowlist">Allowlist (recommended)</SelectItem>
                    <SelectItem value="bypass">Bypass permissions</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {draft.careerOps.permission === "allowlist" && (
                <Field label="Allowed tools" hint="Comma-separated Claude Code permission rules, e.g. Read, Edit, Bash(node *).">
                  <Textarea value={draft.careerOps.allowedTools} onChange={(e) => up((d) => (d.careerOps.allowedTools = e.target.value))} className="font-mono text-xs" />
                </Field>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Portal scanner</CardTitle>
              <CardDescription>Options for career-ops <code>scan.mjs</code> (companies and title filters live in career-ops <code>portals.yml</code>).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Only postings from the last N days" hint="0 = no limit.">
                <Num value={draft.careerOps.scanSinceDays} onChange={(n) => up((d) => (d.careerOps.scanSinceDays = Math.max(0, n)))} />
              </Field>
              <SwitchField label="Verify each new link with Playwright (slower, drops expired postings)" checked={draft.careerOps.scanVerify} onChange={(v) => up((d) => (d.careerOps.scanVerify = v))} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Profile ---------------- */}
        <TabsContent value="profile" className="grid gap-4">
          <SignInCard sources={draft.sources.map((x) => x.url)} />
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Used in email drafts, and by career-ops for CVs, cover letters and outreach.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {(["name", "email", "phone", "linkedin", "portfolio", "location"] as const).map((k) => (
                <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                  <Input value={draft.profile[k]} onChange={(e) => up((d) => (d.profile[k] = e.target.value))} className="h-8" />
                </Field>
              ))}
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <span className="text-muted-foreground text-xs">
                  {careerOps?.available ? (
                    <>
                      Linked to <code>{careerOps.root}/config/profile.yml</code>: saving here updates it, and edits there show up here.
                    </>
                  ) : (
                    "career-ops not found (set CAREER_OPS_ROOT)"
                  )}
                </span>
                <a className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs underline" href="https://github.com/santifer/career-ops" target="_blank" rel="noreferrer">
                  career-ops <ExternalLink className="size-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Which extractor will handle a source link (debounced lookup). */
function SourceKind({ url }: { url: string }) {
  const [kind, setKind] = useState<string | null>(null);
  useEffect(() => {
    setKind(null);
    if (!/^https?:\/\/[^/]+\.[^/]+/.test(url)) return;
    const t = setTimeout(() => {
      api
        .detectSource(url)
        .then((k) => setKind(k.kind === "provider" ? `${k.provider} API` : k.kind === "jsgurujobs" ? "jsgurujobs" : "any site (JSON-LD)"))
        .catch(() => setKind("invalid link"));
    }, 400);
    return () => clearTimeout(t);
  }, [url]);
  if (!kind) return null;
  return (
    <Badge variant={kind === "invalid link" ? "destructive" : "success"} className="shrink-0" title="How this link will be scraped">
      {kind}
    </Badge>
  );
}

/** ADR-001 option C: one persistent browser profile you sign in to yourself; Auto-fill reuses its sessions. */
function SignInCard({ sources }: { sources: string[] }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const sites = [
    ...new Set([
      ...sources.map((u) => {
        try {
          return new URL(u).origin;
        } catch {
          return "";
        }
      }),
      "https://www.linkedin.com/login",
      "https://wellfound.com/login",
      "https://accounts.google.com",
    ]),
  ].filter(Boolean);
  const open = async (target?: string) => {
    setBusy(true);
    try {
      await api.openBrowser(target || undefined);
      toast.success("Opened the Job Radar browser window — sign in there.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to job sites</CardTitle>
        <CardDescription>
          Auto-fill uses its own Chrome window with a saved profile. Sign in to each site there once, yourself: Google sign-in, 2FA and password managers all work. It
          stays signed in, and Job Radar never sees or stores a password. To use Bitwarden, install its extension from the Chrome Web Store inside that window once and sign in to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {sites.map((s) => (
            <Button key={s} variant="outline" size="sm" disabled={busy} onClick={() => open(s)}>
              <ExternalLink /> {new URL(s).hostname.replace(/^www\./, "")}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://any-site.com/login" className="h-8" />
          <Button size="sm" disabled={busy} onClick={() => open(url)}>
            Open
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
