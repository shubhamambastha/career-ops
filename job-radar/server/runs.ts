// Background runs of career-ops tooling: AI modes (claude -p), the portal scanner, and the batch evaluator.
// One run at a time (they share career-ops files); others wait in a queue. Logs live in data/runs/.

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI_MODES } from "../shared/modes";
import { detectFocus, pickResume } from "../shared/scoring";
import type { Job, ResumeDef, RunEvent, RunInfo, Settings } from "../shared/types";
import { CAREER_OPS_ROOT, changedSince, p, snapshot, writeJd } from "./careerops";
import { DATA_DIR } from "./store";

const RUNS_DIR = resolve(DATA_DIR, "runs");
const INDEX = resolve(RUNS_DIR, "index.json");
mkdirSync(RUNS_DIR, { recursive: true });

let runs: RunInfo[] = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf-8")) : [];
// A server restart orphans anything that was in flight.
runs = runs.map((r) => (r.status === "running" || r.status === "queued" ? { ...r, status: "failed", result: r.result || "Interrupted (server restarted)" } : r));

const specs = new Map<string, { cmd: string; args: string[]; parser: "stream-json" | "text" }>();
let current: { id: string; child: ChildProcess } | null = null;

const save = () => writeFileSync(INDEX, JSON.stringify(runs.slice(0, 200), null, 2));
const eventsFile = (id: string) => resolve(RUNS_DIR, `${id}.jsonl`);
const now = () => new Date().toISOString();

function push(id: string, ev: Omit<RunEvent, "t">) {
  appendFileSync(eventsFile(id), JSON.stringify({ t: now(), ...ev }) + "\n");
}

export function listRuns() {
  return runs;
}

export function getRun(id: string) {
  const info = runs.find((r) => r.id === id);
  if (!info) return null;
  const events: RunEvent[] = existsSync(eventsFile(id))
    ? readFileSync(eventsFile(id), "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  return { ...info, events };
}

const HEADLESS_RULES = `
You are running headless, launched from Job Radar (a local UI on top of career-ops). Nobody can answer questions during this run.
- Where the career-ops mode would pause for confirmation or ask a question, make the most reasonable choice, state the assumption in one line, and finish the draft.
- Follow career-ops' rules: never invent experience, skills or metrics; cv.md and config/profile.yml are the source of truth.
- Save every deliverable where the mode says to save it (reports/, output/, interview-prep/, etc.).
- Never submit an application, send a message, or click an apply button. Drafts only.
- End with a short summary and the list of files you created or changed.`;

/** Modes that write a tailored CV: told which of your resume variants the job matches, so they frame cv.md that way. */
const CV_MODES = new Set(["auto-pipeline", "pdf"]);
const FRAMING = { backend: "backend", fullstack: "full-stack", frontend: "frontend", other: "" } as const;

export function cvFraming(job: Job, resumes: ResumeDef[]): string | null {
  const focus = detectFocus(job);
  const { resume, reason } = pickResume(job, focus, resumes);
  if (!resume) return null;
  const angle = FRAMING[focus] || resume.label;
  return [
    `CV framing: this looks like a ${focus} role, and my "${resume.label}" resume is the best match (${reason}).`,
    `Frame the tailored CV as a ${angle} CV: lead the summary, skills and bullet order with the ${angle} experience in cv.md.`,
    "cv.md stays the only source of facts — reorder and emphasise, never add anything that isn't in it. Do not read my resume PDFs.",
  ].join(" ");
}

export function buildPrompt(mode: string, opts: { job?: Job; company?: string; extra?: string; resumes?: ResumeDef[] }) {
  const lines: string[] = [];
  if (mode === "custom") {
    lines.push(opts.extra || "");
  } else {
    lines.push(`Run the career-ops "${mode}" mode (router: .claude/skills/career-ops/SKILL.md, instructions: modes/${mode}.md and the shared modes/_shared.md / modes/_profile.md).`);
  }
  if (opts.job) {
    const jd = writeJd(opts.job);
    lines.push(
      "",
      `Job: ${opts.job.title} at ${opts.job.company}`,
      `Posting URL: ${opts.job.url}`,
      `The job description has been saved to ${jd} — read it from there (the posting page may require login).`,
    );
    const framing = CV_MODES.has(mode) && opts.resumes?.length ? cvFraming(opts.job, opts.resumes) : null;
    if (framing) lines.push("", framing);
  } else if (opts.company) {
    lines.push("", `Company: ${opts.company}`);
  }
  const input = AI_MODES.find((m) => m.id === mode)?.input;
  if (opts.extra && mode !== "custom") lines.push("", input ? `${input} (from the user):\n${opts.extra}` : `Extra instructions from the user: ${opts.extra}`);
  lines.push(HEADLESS_RULES);
  return lines.join("\n");
}

function claudeArgs(prompt: string, s: Settings["careerOps"]) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (s.model) args.push("--model", s.model);
  if (s.permission === "bypass") args.push("--dangerously-skip-permissions");
  else args.push("--permission-mode", "acceptEdits", "--allowedTools", s.allowedTools.replace(/\s*[\n,]\s*/g, ",").replace(/^,|,$/g, ""));
  return args;
}

export function enqueueAi(mode: string, opts: { job?: Job; company?: string; extra?: string }, settings: Settings): RunInfo {
  const def = AI_MODES.find((m) => m.id === mode);
  if (!def) throw new Error(`Unknown mode ${mode}`);
  if (def.needs.includes("job") && !opts.job) throw new Error("Pick a job for this mode");
  if (def.needs.includes("company") && !opts.company && !opts.job) throw new Error("Enter a company for this mode");
  if (def.input && !opts.extra?.trim()) throw new Error(`Fill in: ${def.input}`);
  const prompt = buildPrompt(mode, { ...opts, company: opts.company || opts.job?.company, resumes: settings.resumes });
  const subject = opts.job ? `${opts.job.title} · ${opts.job.company}` : opts.company || "";
  const info = enqueue("ai", mode, `${def.label}${subject ? ` — ${subject}` : ""}`, settings.careerOps.claudeCommand, claudeArgs(prompt, settings.careerOps), "stream-json", opts.job?.id);
  info.prompt = prompt;
  save();
  return info;
}

export function enqueueScan(settings: Settings, extraArgs: string[] = []): RunInfo {
  const args = ["scan.mjs", "--quiet"];
  if (settings.careerOps.scanSinceDays > 0) args.push("--since", String(settings.careerOps.scanSinceDays));
  if (settings.careerOps.scanVerify) args.push("--verify");
  return enqueue("scan", "scan", "Portal scan (scan.mjs)", process.execPath, [...args, ...extraArgs], "text");
}

/** career-ops' own headless evaluator (batch/batch-runner.sh) for one URL: report + tailored PDF + tracker row. */
export function enqueueBatch(job: Job): RunInfo {
  const runner = p("batch", "batch-runner.sh");
  if (!existsSync(runner)) throw new Error("career-ops batch/batch-runner.sh not found");
  const input = p("batch", "batch-input.tsv");
  let nextId = 1;
  if (existsSync(input)) {
    for (const line of readFileSync(input, "utf-8").trim().split("\n").slice(1)) {
      const n = parseInt(line.split("\t")[0], 10);
      if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
    }
  } else writeFileSync(input, "id\turl\tsource\tnotes\n");
  appendFileSync(input, `${nextId}\t${job.url}\tjob-radar\t${job.title.replace(/\t/g, " ")} @ ${job.company.replace(/\t/g, " ")}\n`);
  return enqueue("batch", "batch", `Batch evaluate — ${job.title} · ${job.company}`, runner, ["--start-from", String(nextId), "--limit", "1"], "text", job.id);
}

function enqueue(kind: RunInfo["kind"], mode: string, title: string, cmd: string, args: string[], parser: "stream-json" | "text", jobId?: string): RunInfo {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const info: RunInfo = { id, kind, mode, title, jobId, status: "queued", createdAt: now(), outputs: [] };
  runs.unshift(info);
  specs.set(id, { cmd, args, parser });
  save();
  setImmediate(pump);
  return info;
}

export function cancelRun(id: string) {
  const r = runs.find((x) => x.id === id);
  if (!r) return false;
  if (r.status === "queued") {
    r.status = "cancelled";
    r.finishedAt = now();
    specs.delete(id);
    save();
    return true;
  }
  if (current?.id === id) {
    try {
      process.kill(-current.child.pid!, "SIGTERM");
    } catch {
      current.child.kill("SIGTERM");
    }
    r.status = "cancelled";
    save();
    return true;
  }
  return false;
}

/** Turns one line of `claude -p --output-format stream-json` into readable events. */
function handleStreamJson(id: string, info: RunInfo, line: string) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    push(id, { kind: "log", text: line });
    return;
  }
  if (msg.type === "assistant") {
    for (const c of msg.message?.content || []) {
      if (c.type === "text" && c.text?.trim()) push(id, { kind: "text", text: c.text });
      if (c.type === "tool_use") {
        const input = c.input || {};
        const detail = input.file_path || input.path || input.pattern || input.url || input.query || input.command || input.description || "";
        push(id, { kind: "tool", text: `${c.name}${detail ? ` · ${String(detail).slice(0, 200)}` : ""}` });
      }
    }
  } else if (msg.type === "result") {
    info.result = msg.result || info.result;
    info.costUsd = msg.total_cost_usd;
    if (msg.is_error || msg.subtype !== "success") push(id, { kind: "error", text: msg.result || msg.subtype || "error" });
    else push(id, { kind: "result", text: msg.result || "" });
  } else if (msg.type === "system" && msg.subtype === "init") {
    push(id, { kind: "log", text: `Session started · model ${msg.model || "default"} · cwd ${msg.cwd || CAREER_OPS_ROOT}` });
  }
}

function pump() {
  if (current) return;
  const next = [...runs].reverse().find((r) => r.status === "queued");
  if (!next) return;
  const spec = specs.get(next.id);
  if (!spec) {
    next.status = "failed";
    next.result = "Lost queue entry (server restarted)";
    save();
    return pump();
  }
  const before = snapshot();
  next.status = "running";
  next.startedAt = now();
  save();
  push(next.id, { kind: "log", text: `$ ${spec.cmd} ${spec.args.map((a) => (a.includes(" ") || a.includes("\n") ? JSON.stringify(a.length > 80 ? a.slice(0, 80) + "…" : a) : a)).join(" ")}` });

  let child: ChildProcess;
  try {
    child = spawn(spec.cmd, spec.args, {
      cwd: CAREER_OPS_ROOT,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  } catch (e) {
    next.status = "failed";
    next.result = (e as Error).message;
    save();
    return pump();
  }
  current = { id: next.id, child };
  let buf = "";
  const onLine = (line: string) => {
    if (!line.trim()) return;
    if (spec.parser === "stream-json") handleStreamJson(next.id, next, line);
    else push(next.id, { kind: "log", text: line });
  };
  child.stdout!.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  child.stderr!.on("data", (d) => push(next.id, { kind: "log", text: d.toString().trimEnd() }));
  child.on("error", (e) => {
    push(next.id, {
      kind: "error",
      text: (e as NodeJS.ErrnoException).code === "ENOENT" ? `Command not found: ${spec.cmd}. Install Claude Code (npm i -g @anthropic-ai/claude-code) or set the command in Settings → career-ops.` : e.message,
    });
  });
  child.on("close", (code) => {
    if (buf.trim()) onLine(buf);
    next.exitCode = code;
    next.finishedAt = now();
    next.outputs = changedSince(before);
    if (next.status !== "cancelled") next.status = code === 0 ? "done" : "failed";
    if (next.kind !== "ai" && !next.result) next.result = code === 0 ? "Finished" : `Exited with code ${code}`;
    push(next.id, { kind: "log", text: `exit ${code} · ${next.outputs.length} file(s) created/changed` });
    specs.delete(next.id);
    current = null;
    save();
    onFinish.forEach((f) => f(next));
    pump();
  });
}

const onFinish: Array<(r: RunInfo) => void> = [];
export function onRunFinished(f: (r: RunInfo) => void) {
  onFinish.push(f);
}
