import express from "express";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { TRACK_STATUSES, type Job, type Settings, type Tracking, type TrackStatus } from "../shared/types";
import { autofill, openInBrowser } from "./autofill";
import * as co from "./careerops";
import { run } from "./proc";
import { cancelRun, enqueueAi, enqueueBatch, enqueueScan, getRun, listRuns, onRunFinished } from "./runs";
import { cancelScrape, detectSource, runScrape, status as scrapeStatus, supportedHost, type ScrapeMode } from "./scrape";
import { listResumeFiles, listTailored, migrateLegacyResumes, resumeDir, resumeFile } from "./resumes";
import { APP_ROOT, store } from "./store";

const app = express();
app.use(express.json({ limit: "2mb" }));

const wrap =
  (fn: (req: express.Request, res: express.Response) => unknown) =>
  async (req: express.Request, res: express.Response) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (!res.headersSent) res.status(400).json({ error: (e as Error).message });
    }
  };

// ---- Jobs -------------------------------------------------------------------
app.get("/api/jobs", (_req, res) => {
  const jobs = Object.values(store.getJobs()).map(({ descriptionHtml, ...j }) => ({
    ...j,
    descriptionText: j.descriptionText.slice(0, 6000),
  }));
  res.json({ jobs, tracking: store.getTracking() });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = store.getJobs()[req.params.id];
  if (!job) return void res.status(404).json({ error: "not found" });
  res.json(job);
});

// ---- Tracking (applied / status / notes), mirrored into career-ops' tracker ------------
app.put(
  "/api/tracking/:jobId",
  wrap(async (req) => {
    const jobId = String(req.params.jobId);
    const job = store.getJobs()[jobId];
    if (!job) throw new Error("unknown job");
    const body = req.body as Partial<Tracking> & { note?: string };
    if (body.status && !TRACK_STATUSES.includes(body.status as TrackStatus)) throw new Error("bad status");
    const all = store.getTracking();
    const now = new Date().toISOString();
    const prev: Tracking = all[jobId] || { jobId, status: "New", updatedAt: now, history: [] };
    const next: Tracking = { ...prev, updatedAt: now };
    const statusChanged = !!body.status && body.status !== prev.status;
    if (statusChanged) {
      next.status = body.status!;
      next.history = [...prev.history, { at: now, status: body.status!, note: body.note }];
      if (body.status === "Applied" && !prev.appliedAt) next.appliedAt = now;
    }
    for (const k of ["method", "resumeId", "notes", "starred", "appliedAt"] as const) {
      if (k in body) (next as any)[k] = body[k];
    }

    let sync: { row?: number; created?: boolean; error?: string } | undefined;
    const settings = store.getSettings();
    if (statusChanged && settings.careerOps.syncTracker && co.available() && co.SYNCED_STATES[next.status]) {
      try {
        const note = [body.note, next.method && next.status === "Applied" ? `via Job Radar (${next.method})` : "", next.resumeId && next.status === "Applied" ? `resume: ${next.resumeId.replace(/^output:/, "")}` : ""]
          .filter(Boolean)
          .join(" · ");
        const r = await co.syncStatus(job, next.status, prev.careerOpsRow, note);
        if ("row" in r) {
          next.careerOpsRow = r.row;
          sync = { row: r.row, created: r.created };
        }
      } catch (e) {
        sync = { error: (e as Error).message };
      }
    }
    all[jobId] = next;
    store.saveTracking(all);
    return { ...next, sync };
  }),
);

// ---- Settings ---------------------------------------------------------------
// Profile is linked to career-ops config/profile.yml: read from it, written back to it.
function settingsWithProfile(): Settings {
  const s = store.getSettings();
  const { homeCountry: _, ...fromYml } = co.readProfile() ?? {};
  return { ...s, profile: { ...s.profile, ...Object.fromEntries(Object.entries(fromYml).filter(([, v]) => v)) } };
}
app.get("/api/settings", (_req, res) => res.json(settingsWithProfile()));
app.put("/api/settings", wrap((req) => {
  const s = req.body as Settings;
  if (!s?.scoring || !s?.sources || !s?.resumes) throw new Error("invalid settings");
  store.saveSettings(s);
  const profileUpdated = s.profile ? co.writeProfile(s.profile) : [];
  return { ...settingsWithProfile(), profileUpdated };
}));

// ---- Scraping ---------------------------------------------------------------
app.get("/api/scrape/status", (_req, res) => res.json(scrapeStatus));
app.post("/api/scrape", (req, res) => {
  const { sourceId, mode = "quick" } = req.body as { sourceId?: string; mode?: ScrapeMode };
  const settings = store.getSettings();
  const sources = settings.sources.filter((s) => s.enabled && (!sourceId || s.id === sourceId));
  if (!sources.length) return void res.status(400).json({ error: "no enabled source" });
  if (scrapeStatus.running) return void res.status(409).json({ error: "a scrape is already running" });
  const unsupported = sources.filter((s) => !supportedHost(s.url));
  if (unsupported.length === sources.length) return void res.status(400).json({ error: `Not a web link: ${unsupported[0].url}` });
  (async () => {
    for (const s of sources.filter((x) => supportedHost(x.url))) {
      try {
        await runScrape(s, mode);
      } catch (e) {
        console.error(e);
      }
    }
  })();
  res.json({ started: true });
});
app.get("/api/scrape/detect", wrap((req) => detectSource(String(req.query.url || ""))));
app.post("/api/scrape/cancel", (_req, res) => {
  cancelScrape();
  res.json({ ok: true });
});

// ---- Resumes (shared with career-ops: documents/cv/ for base resumes, output/ for tailored) ----------
app.get("/api/resumes", (_req, res) => {
  const settings = store.getSettings();
  res.json({
    dir: resumeDir(settings),
    files: listResumeFiles(settings),
    resumes: settings.resumes.map((r) => ({ ...r, exists: existsSync(resumeFile(settings, r.file)) })),
    tailored: co.available() ? listTailored() : [],
  });
});
app.get("/api/resumes/:id/file", (req, res) => {
  const settings = store.getSettings();
  const r = settings.resumes.find((x) => x.id === req.params.id);
  const file = r && resumeFile(settings, r.file);
  if (!file || !existsSync(file)) return void res.status(404).send("resume file not found");
  res.sendFile(file);
});
app.get("/api/resumes/by-name/:file", (req, res) => {
  const file = resumeFile(store.getSettings(), basename(String(req.params.file)));
  if (!existsSync(file)) return void res.status(404).send("not found");
  res.sendFile(file);
});
app.post("/api/resumes/upload", express.raw({ type: "application/pdf", limit: "15mb" }), (req, res) => {
  const name = basename(String(req.query.name || "")).replace(/[^\w .()-]/g, "_");
  if (!name.toLowerCase().endsWith(".pdf") || !Buffer.isBuffer(req.body)) return void res.status(400).json({ error: "send a PDF with ?name=file.pdf" });
  const dir = resumeDir(store.getSettings());
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), req.body);
  res.json({ file: name, dir });
});

// ---- career-ops bridge --------------------------------------------------------
let claudeVersion: string | null | undefined;
app.get(
  "/api/careerops",
  wrap(async () => {
    const s = store.getSettings().careerOps;
    if (claudeVersion === undefined) {
      const r = await run(s.claudeCommand, ["--version"], { cwd: co.CAREER_OPS_ROOT, timeoutMs: 15_000 });
      claudeVersion = r.code === 0 ? r.stdout.trim() : null;
    }
    return { available: co.available(), root: co.CAREER_OPS_ROOT, profile: co.readProfile(), claude: claudeVersion };
  }),
);

app.get("/api/co/tracker", wrap(() => ({ rows: co.readTracker(), states: co.readStates(), reports: co.listReports() })));
app.post(
  "/api/co/tracker/:row/status",
  wrap(async (req) => {
    const out = await co.setStatus(Number(req.params.row), String(req.body?.state || ""), req.body?.note ? String(req.body.note) : undefined);
    return out ?? { ok: true };
  }),
);
app.get(
  "/api/co/file",
  wrap((req, res) => {
    const full = co.safePath(String(req.query.path || ""));
    if (/\.(md|txt|tsv|json|log|yml)$/i.test(full)) return { path: req.query.path, content: readFileSync(full, "utf-8") };
    res.sendFile(full);
    return undefined;
  }),
);
app.post("/api/co/pipeline", wrap((req) => co.addToPipeline(String(req.body?.url || ""))));
app.get("/api/co/insights", (_req, res) => res.json(Object.entries(co.INSIGHTS).map(([id, d]) => ({ id, title: d.title, description: d.description }))));
app.get("/api/co/insights/:name", wrap((req) => co.insight(String(req.params.name))));

const jobOr404 = (id: string): Job => {
  const job = store.getJobs()[id];
  if (!job) throw new Error("unknown job");
  return job;
};
app.get("/api/co/skill-gap/:jobId", wrap((req) => co.skillGap(jobOr404(String(req.params.jobId)))));
app.get("/api/co/liveness/:jobId", wrap((req) => co.liveness(jobOr404(String(req.params.jobId)).url)));

// Runs: AI modes, scanner, batch evaluator
app.get("/api/co/runs", (_req, res) => res.json(listRuns()));
app.get("/api/co/runs/:id", (req, res) => {
  const r = getRun(req.params.id);
  if (!r) return void res.status(404).json({ error: "not found" });
  res.json(r);
});
app.post(
  "/api/co/runs",
  wrap((req) => {
    const { kind = "ai", mode, jobId, company, extra } = req.body as { kind?: string; mode?: string; jobId?: string; company?: string; extra?: string };
    const settings = store.getSettings();
    if (kind === "scan") return enqueueScan(settings);
    if (kind === "batch") return enqueueBatch(jobOr404(String(jobId)));
    return enqueueAi(String(mode), { job: jobId ? jobOr404(jobId) : undefined, company, extra }, settings);
  }),
);
app.post("/api/co/runs/:id/cancel", (req, res) => res.json({ ok: cancelRun(req.params.id) }));

// Portal scanner results → Job Radar jobs (source "careerops-scan")
function importScanResults() {
  const rows = co.readScanHistory();
  const jobs = store.getJobs();
  const nowIso = new Date().toISOString();
  let added = 0;
  for (const r of rows) {
    if (r.status !== "added" && !r.status.startsWith("cooldown")) continue;
    const sid = createHash("sha1").update(r.url).digest("hex").slice(0, 12);
    const id = `careerops-scan:${sid}`;
    if (jobs[id]) continue;
    jobs[id] = {
      id,
      source: "careerops-scan",
      sourceId: sid,
      url: r.url,
      title: r.title,
      company: r.company,
      location: r.location,
      workFormat: /remote/i.test(r.location) ? ["Remote"] : [],
      jobType: "",
      salaryText: "",
      postedAt: /^\d{4}-\d{2}-\d{2}/.test(r.postedAt) ? r.postedAt.slice(0, 10) : r.firstSeen || null,
      skills: [],
      descriptionText: `Found by career-ops portal scanner (${r.portal}). Open the posting for the full description, or run an AI evaluation.`,
      descriptionHtml: "",
      whoFor: "",
      summary: "",
      minYears: null,
      emails: [],
      applyLinks: [r.url],
      status: "open",
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastFetchedAt: nowIso,
    };
    added++;
  }
  if (added) store.saveJobs(jobs);
  return { added, total: rows.length };
}
app.post("/api/co/scan/import", wrap(() => importScanResults()));
app.get("/api/co/scan/results", wrap(() => ({ rows: co.readScanHistory().slice(-500).reverse() })));
onRunFinished((r) => {
  if (r.kind === "scan" && r.status === "done") {
    try {
      const out = importScanResults();
      console.log(`[scan] imported ${out.added} new jobs from scan-history.tsv`);
    } catch (e) {
      console.error(e);
    }
  }
});

// Auto-fill the application form in a visible browser. Fills and stops — you review and submit.
app.post(
  "/api/apply/autofill",
  wrap(async (req) => {
    const { jobId, resumeId, url } = req.body as { jobId?: string; resumeId?: string; url?: string };
    const job = jobOr404(String(jobId));
    const target = url || job.applyLinks[0] || job.url;
    if (!/^https?:\/\//.test(target)) throw new Error("No web link to apply at");
    const settings = settingsWithProfile();
    let resumePath: string | null = null;
    if (resumeId?.startsWith("output:")) resumePath = co.safePath(resumeId.slice(7));
    else {
      const r = settings.resumes.find((x) => x.id === resumeId);
      const file = r && resumeFile(settings, r.file);
      resumePath = file && existsSync(file) ? file : null;
    }
    return autofill(target, settings.profile, resumePath);
  }),
);

// Opens the signed-in browser window (persistent profile) so you can sign in to a site yourself.
app.post(
  "/api/browser/open",
  wrap((req) => {
    const url = String(req.body?.url || "about:blank");
    if (url !== "about:blank" && !/^https?:\/\//.test(url)) throw new Error("Enter a web address");
    return openInBrowser(url);
  }),
);

// Back-compat endpoints used by the job panel / apply dialog
app.post("/api/careerops/pipeline", wrap((req) => co.addToPipeline(String(req.body?.url || ""))));

// ---- Static UI (production) ---------------------------------------------------
const dist = resolve(APP_ROOT, "dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

{
  const moved = migrateLegacyResumes(store.getSettings());
  if (moved.length) console.log(`[resumes] moved ${moved.length} PDF(s) from job-radar/data/resumes to ${resumeDir(store.getSettings())}`);
}

const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`job-radar API on http://${HOST}:${PORT}${process.env.NODE_ENV === "production" ? " (serving UI)" : ""} · career-ops: ${co.CAREER_OPS_ROOT}`);
});
