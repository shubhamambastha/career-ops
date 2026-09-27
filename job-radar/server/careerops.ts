// Bridges to the parent career-ops repo (job-radar lives in career-ops/job-radar).
// Reads go straight to career-ops' files; every tracker write goes through career-ops'
// own scripts (merge-tracker.mjs, set-status.mjs). Nothing is ever submitted anywhere.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import type { Job, Profile, TrackerRow, TrackStatus } from "../shared/types";
import { parseJson, run } from "./proc";
import { APP_ROOT, DATA_DIR } from "./store";

export const CAREER_OPS_ROOT = process.env.CAREER_OPS_ROOT || resolve(APP_ROOT, "..");
export const p = (...parts: string[]) => resolve(CAREER_OPS_ROOT, ...parts);
const node = (script: string, args: string[] = [], timeoutMs = 60_000) => run(process.execPath, [script, ...args], { cwd: CAREER_OPS_ROOT, timeoutMs });

export function available() {
  return existsSync(p("config", "profile.yml")) || existsSync(p("cv.md"));
}

// ---- Profile --------------------------------------------------------------------

export function readProfile() {
  const file = p("config", "profile.yml");
  if (!existsSync(file)) return null;
  const doc = YAML.parse(readFileSync(file, "utf-8")) || {};
  const c = doc.candidate || {};
  const loc = doc.location || {};
  return {
    name: c.full_name || "",
    email: c.email || "",
    phone: c.phone || "",
    linkedin: c.linkedin ? (String(c.linkedin).startsWith("http") ? c.linkedin : `https://${c.linkedin}`) : "",
    portfolio: c.portfolio_url || "",
    location: c.location || [loc.city, loc.country].filter(Boolean).join(", "),
    homeCountry: loc.country || "",
  };
}

/** Settings profile field → profile.yml path. */
const PROFILE_KEYS: Record<keyof Profile, string[]> = {
  name: ["candidate", "full_name"],
  email: ["candidate", "email"],
  phone: ["candidate", "phone"],
  linkedin: ["candidate", "linkedin"],
  portfolio: ["candidate", "portfolio_url"],
  location: ["candidate", "location"],
};
const bareUrl = (s: string) => s.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Writes Settings → Profile back into config/profile.yml (the source of truth), editing only the
 * candidate fields that changed so comments, quoting and every other key stay as they are.
 */
export function writeProfile(profile: Profile): string[] {
  const file = p("config", "profile.yml");
  if (!existsSync(file)) return [];
  const doc = YAML.parseDocument(readFileSync(file, "utf-8"));
  const changed: string[] = [];
  for (const [k, path] of Object.entries(PROFILE_KEYS) as Array<[keyof Profile, string[]]>) {
    const next = (profile[k] ?? "").trim();
    const node = doc.getIn(path, true);
    const cur = YAML.isScalar(node) ? String(node.value ?? "") : "";
    const same = k === "linkedin" ? bareUrl(cur) === bareUrl(next) : cur === next;
    if (same || (!next && !cur)) continue;
    const value = k === "linkedin" && cur && !/^https?:/.test(cur) ? bareUrl(next) : next; // keep the file's URL style
    if (YAML.isScalar(node)) node.value = value;
    else doc.setIn(path, value);
    changed.push(path.join("."));
  }
  if (changed.length) writeFileSync(file, doc.toString());
  return changed;
}

// ---- Tracker (data/applications.md) ---------------------------------------------

const TRACKER = () => (existsSync(p("data", "applications.md")) ? p("data", "applications.md") : p("applications.md"));

export function readTracker(): TrackerRow[] {
  const file = TRACKER();
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf-8").split("\n");
  const headerIdx = lines.findIndex((l) => l.trim().startsWith("|") && /\|\s*#\s*\|/.test(l));
  if (headerIdx < 0) return [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const headers = cells(lines[headerIdx]).map((h) => h.toLowerCase());
  const rows: TrackerRow[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) break;
    const v = cells(lines[i]);
    const get = (h: string) => v[headers.indexOf(h)] ?? "";
    const report = get("report");
    const m = report.match(/\[(\d+)\]\(([^)]+)\)/);
    rows.push({
      num: parseInt(get("#"), 10),
      date: get("date"),
      company: get("company"),
      role: get("role"),
      score: get("score"),
      status: get("status"),
      pdf: get("pdf"),
      report,
      reportNum: m ? m[1].padStart(3, "0") : null,
      notes: get("notes"),
      url: get("url") || undefined,
    });
  }
  return rows;
}

export function readStates(): string[] {
  try {
    const yml = readFileSync(p("templates", "states.yml"), "utf-8");
    return [...yml.matchAll(/^\s*label:\s*(.+)$/gm)].map((m) => m[1].trim());
  } catch {
    return ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Hired", "Rejected", "Discarded", "SKIP"];
  }
}

/** Canonical status write: set-status.mjs (locked, validated, logs to status-log.tsv). */
export async function setStatus(row: number, state: string, note?: string) {
  const args = ["--row", String(row), state, "--source", "web", "--json"];
  if (note) args.push("--note", note);
  const r = await node("set-status.mjs", args);
  const out = parseJson(r.stdout) as Record<string, unknown> | null;
  if (r.code !== 0) throw new Error((out?.error as string) || r.stderr.trim() || r.stdout.trim() || "set-status failed");
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Finds the tracker row for a Job Radar job: URL first, then company + role word overlap. */
export function findTrackerRow(job: Job, rows = readTracker()): TrackerRow | undefined {
  const byUrl = rows.find((r) => r.url && r.url.replace(/\/$/, "") === job.url.replace(/\/$/, ""));
  if (byUrl) return byUrl;
  const co = norm(job.company);
  const words = new Set(norm(job.title).split(" ").filter((w) => w.length > 2));
  const candidates = rows.filter((r) => co && (norm(r.company) === co || norm(r.company).startsWith(co) || co.startsWith(norm(r.company))));
  let best: TrackerRow | undefined;
  let bestScore = 0;
  for (const r of candidates) {
    const rw = norm(r.role).split(" ").filter((w) => w.length > 2);
    const overlap = rw.filter((w) => words.has(w)).length / Math.max(1, Math.min(rw.length, words.size));
    if (overlap > bestScore) {
      best = r;
      bestScore = overlap;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

const tsvSafe = (s: string) => s.replace(/[\t\r\n|]+/g, " ").trim();

/** Adds a backfilled row (no evaluation → score N/A) the documented way: TSV addition + merge-tracker.mjs. */
export async function addTrackerRow(job: Job, status: string, note: string): Promise<number> {
  const reserve = await node("reserve-report-num.mjs", ["--count", "1"]);
  const numStr = reserve.stdout.trim().split(/\s+/).pop() || "";
  const num = parseInt(numStr, 10);
  if (!Number.isFinite(num)) throw new Error(`Could not reserve a tracker number: ${reserve.stderr || reserve.stdout}`);
  const date = new Date().toISOString().slice(0, 10);
  const slug = norm(job.company).replace(/ /g, "-").slice(0, 40) || "company";
  const dir = p("batch", "tracker-additions");
  mkdirSync(dir, { recursive: true });
  const line = [num, date, tsvSafe(job.company || "?"), tsvSafe(job.title), status, "N/A", "❌", "-", tsvSafe(note), job.url].join("\t");
  writeFileSync(resolve(dir, `${numStr}-${slug}.tsv`), line + "\n");
  const merged = await node("merge-tracker.mjs", [], 120_000);
  await node("reserve-report-num.mjs", ["--release", numStr]).catch(() => null);
  if (merged.code !== 0) throw new Error(`merge-tracker failed: ${merged.stderr || merged.stdout}`);
  const row = readTracker().find((r) => r.num === num) || findTrackerRow(job);
  if (!row) throw new Error("Row was not added — check batch/tracker-additions for a skipped TSV");
  return row.num;
}

/** Job Radar status → career-ops canonical state (only states that belong in the tracker). */
export const SYNCED_STATES: Partial<Record<TrackStatus, string>> = {
  Applied: "Applied",
  Responded: "Responded",
  Interview: "Interview",
  Offer: "Offer",
  Rejected: "Rejected",
  Discarded: "Discarded",
};

export async function syncStatus(job: Job, status: TrackStatus, knownRow: number | undefined, note: string) {
  const state = SYNCED_STATES[status];
  if (!state) return { skipped: true as const };
  const rows = readTracker();
  const row = (knownRow && rows.find((r) => r.num === knownRow)) || findTrackerRow(job, rows);
  if (row) {
    if (row.status.toLowerCase() !== state.toLowerCase()) await setStatus(row.num, state, note || undefined);
    return { row: row.num, created: false };
  }
  const num = await addTrackerRow(job, state, note || `Tracked from Job Radar (${job.source})`);
  return { row: num, created: true };
}

// ---- Reports & files ------------------------------------------------------------

/** Folders career-ops writes deliverables into; the only places the UI can read files from. */
export const OUTPUT_DIRS = ["reports", "output", "interview-prep", "jds", "data", "batch/logs"];

export function listReports() {
  const dir = p("reports");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !/RESERVED/i.test(f))
    .map((f) => ({ file: `reports/${f}`, num: f.split("-")[0], mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

export function safePath(rel: string) {
  const full = resolve(CAREER_OPS_ROOT, rel);
  const ok = OUTPUT_DIRS.some((d) => full.startsWith(p(d) + sep)) || full === p("cv.md");
  if (!ok || !existsSync(full) || !statSync(full).isFile()) throw new Error("File not available");
  return full;
}

/** Snapshot of files (path → mtime) in the output folders, to detect what a run produced. */
export function snapshot(): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (dir: string, depth: number) => {
    if (!existsSync(dir) || depth > 3) return;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, f.name);
      if (f.isDirectory()) walk(full, depth + 1);
      else if (f.isFile()) out.set(relative(CAREER_OPS_ROOT, full), statSync(full).mtimeMs);
    }
  };
  for (const d of OUTPUT_DIRS) walk(p(d), 0);
  return out;
}

export function changedSince(before: Map<string, number>) {
  const after = snapshot();
  return [...after.entries()]
    .filter(([f, m]) => before.get(f) !== m && !f.startsWith("batch/logs/job-radar-"))
    .map(([f]) => f)
    .sort();
}

// ---- Pipeline (data/pipeline.md) --------------------------------------------------

export function addToPipeline(url: string): { added: boolean } {
  const file = p("data", "pipeline.md");
  const current = existsSync(file) ? readFileSync(file, "utf-8") : "# Pipeline — Pending URLs\n\n## Pending\n";
  if (current.includes(url)) return { added: false };
  const line = `- [ ] ${url}`;
  const next = /## Pending\s*\n/.test(current) ? current.replace(/## Pending\s*\n/, (m) => `${m}${line}\n`) : `${current.trimEnd()}\n\n## Pending\n${line}\n`;
  mkdirSync(p("data"), { recursive: true });
  writeFileSync(file, next);
  return { added: true };
}

// ---- Insights (zero-LLM scripts) ---------------------------------------------------

export const INSIGHTS: Record<string, { script: string; title: string; summary: boolean; description: string }> = {
  stats: { script: "stats.mjs", title: "Pipeline stats", summary: true, description: "Tracker roll-up, funnel, scanner and follow-up totals." },
  followups: { script: "followup-cadence.mjs", title: "Follow-ups due", summary: true, description: "Which applications need a follow-up now, and which are overdue." },
  funnel: { script: "funnel-velocity.mjs", title: "Funnel & velocity", summary: true, description: "Response / interview rates and time between stages, vs market benchmarks." },
  patterns: { script: "analyze-patterns.mjs", title: "Rejection patterns", summary: false, description: "What your advancing applications have in common (needs 5+ applications past Evaluated)." },
  upskill: { script: "upskill.mjs", title: "Skill gaps across pipeline", summary: false, description: "Weighted skill-gap map from your evaluation reports (needs 5+ reports)." },
  salary: { script: "salary-gap.mjs", title: "Salary gap", summary: true, description: "Desired vs advertised vs actual compensation." },
  reposts: { script: "detect-reposts.mjs", title: "Reposted roles", summary: true, description: "Roles re-listed 2+ times in 90 days (from scan history)." },
  latency: { script: "rejection-latency.mjs", title: "Gone quiet after interview", summary: true, description: "Companies still in Interview whose silence since the last round is past a 30-day courtesy window." },
  process: { script: "process-quality.mjs", title: "Recruiting friction", summary: true, description: "Per-company process-friction rate from your interview notes." },
  sync: { script: "tracker-sync-check.mjs", title: "Tracker vs interviews drift", summary: true, description: "Status mismatches between applications.md and active-interviews.md." },
  digest: { script: "weekly-digest.mjs", title: "Weekly interview digest", summary: true, description: "This week's interview rounds, recurring question themes and gaps." },
  contacts: { script: "contacts.mjs", title: "Contacts", summary: true, description: "Your job-search phonebook (data/contacts.tsv)." },
  health: { script: "verify-pipeline.mjs", title: "Pipeline health", summary: false, description: "Integrity checks on tracker, reports and statuses." },
};

export async function insight(name: string) {
  const def = INSIGHTS[name];
  if (!def) throw new Error("unknown insight");
  const [json, summary] = await Promise.all([
    name === "health" ? Promise.resolve(null) : node(def.script, []),
    def.summary || name === "health" ? node(def.script, name === "health" ? [] : ["--summary"]) : Promise.resolve(null),
  ]);
  return { name, ...def, json: json ? parseJson(json.stdout) : null, summary: summary ? (summary.stdout || summary.stderr).trim() : null };
}

// ---- Per-job checks --------------------------------------------------------------

function jdFile(job: Job) {
  const dir = resolve(DATA_DIR, "tmp");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `jd-${job.id.replace(/[^\w-]/g, "_")}.md`);
  writeFileSync(
    file,
    `# ${job.title} — ${job.company}\n\n${job.location}\n\n## Requirements\n\n${job.skills.map((s) => `- ${s}`).join("\n")}\n\n${job.whoFor}\n\n## Description\n\n${job.descriptionText}\n`,
  );
  return file;
}

export async function skillGap(job: Job) {
  const r = await node("jd-skill-gap.mjs", [jdFile(job)]);
  const json = parseJson(r.stdout);
  if (!json) throw new Error(r.stderr || "jd-skill-gap returned no JSON");
  return json;
}

export async function liveness(url: string) {
  const r = await node("check-liveness.mjs", [url, "--no-fallback"], 90_000);
  const text = (r.stdout + "\n" + r.stderr).trim();
  const verdict = /expired|closed|no longer|404|410/i.test(text) && r.code !== 0 ? "expired" : r.code === 0 ? "active" : "uncertain";
  return { verdict, output: text.slice(-3000) };
}

/** Writes the job's description into career-ops jds/ so AI modes can read it instead of fetching. */
export function writeJd(job: Job) {
  const dir = p("jds");
  mkdirSync(dir, { recursive: true });
  const name = `job-radar-${job.id.replace(/[^\w-]/g, "_")}.md`;
  writeFileSync(
    resolve(dir, name),
    `# ${job.title}\n\n**Company:** ${job.company}\n**Location:** ${job.location} ${job.workFormat.join(", ")}\n**Salary:** ${job.salaryText || "n/a"}\n**Posted:** ${job.postedAt || "n/a"}\n**URL:** ${job.url}\n**Skills:** ${job.skills.join(", ")}\n\n${job.whoFor ? `## Who is this for\n\n${job.whoFor}\n\n` : ""}## Description\n\n${job.descriptionText}\n`,
  );
  return `jds/${name}`;
}

// ---- Portal scanner results (data/scan-history.tsv) ---------------------------------

export interface ScanRow {
  url: string;
  firstSeen: string;
  portal: string;
  title: string;
  company: string;
  status: string;
  location: string;
  postedAt: string;
}

export function readScanHistory(): ScanRow[] {
  const file = process.env.CAREER_OPS_SCAN_HISTORY || p("data", "scan-history.tsv");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .slice(1)
    .filter((l) => l.trim() && !l.startsWith("url\t"))
    .map((l) => {
      const c = l.split("\t");
      return { url: c[0], firstSeen: c[1] || "", portal: c[2] || "", title: c[3] || "", company: c[4] || "", status: c[5] || "added", location: c[6] || "", postedAt: c[8] || "" };
    })
    .filter((r) => /^https?:\/\//.test(r.url));
}
