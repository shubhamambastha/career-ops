// One home for resumes, shared with career-ops:
//   - base resumes (the PDFs you send as-is) → career-ops documents/cv/  (career-ops' own "master CV" folder:
//     user layer, gitignored, never touched by its updater, and read by its `intake` mode)
//   - tailored resumes → career-ops output/  (where its `pdf` mode / batch worker write them, incl. nested
//     output/<application>/cv/tailored/vNNN/cv.pdf bundles), linked to reports via data/pdf-index.tsv
// Without career-ops, job-radar falls back to job-radar/data/resumes/.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { Settings } from "../shared/types";
import { available, CAREER_OPS_ROOT, p } from "./careerops";
import { DATA_DIR } from "./store";

const LEGACY_DIR = resolve(DATA_DIR, "resumes");

export function resumeDir(settings: Settings): string {
  const custom = settings.resumeFolder?.trim();
  if (custom) return isAbsolute(custom) ? custom : resolve(CAREER_OPS_ROOT, custom);
  return available() ? p("documents", "cv") : LEGACY_DIR;
}

export function resumeFile(settings: Settings, file: string) {
  if (isAbsolute(file)) return file;
  const inDir = resolve(resumeDir(settings), basename(file));
  if (existsSync(inDir)) return inDir;
  const legacy = resolve(LEGACY_DIR, basename(file));
  return existsSync(legacy) ? legacy : inDir;
}

export function listResumeFiles(settings: Settings) {
  const dir = resumeDir(settings);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => ({ file: f, size: statSync(resolve(dir, f)).size, mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** Moves PDFs from the old job-radar/data/resumes/ into the shared folder (never overwrites). */
export function migrateLegacyResumes(settings: Settings) {
  const dir = resumeDir(settings);
  if (dir === LEGACY_DIR || !existsSync(LEGACY_DIR)) return [];
  mkdirSync(dir, { recursive: true });
  const moved: string[] = [];
  for (const f of readdirSync(LEGACY_DIR).filter((x) => x.toLowerCase().endsWith(".pdf"))) {
    const to = resolve(dir, f);
    if (existsSync(to)) continue;
    try {
      renameSync(resolve(LEGACY_DIR, f), to);
    } catch {
      copyFileSync(resolve(LEGACY_DIR, f), to);
    }
    moved.push(f);
  }
  return moved;
}

/** report number → PDF path(s), from career-ops data/pdf-index.tsv (written by generate-pdf.mjs). */
function pdfIndex(): Map<string, string> {
  const file = p("data", "pdf-index.tsv");
  const out = new Map<string, string>();
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [report, pdf] = line.split("\t");
    if (report && pdf) out.set(relative(CAREER_OPS_ROOT, resolve(CAREER_OPS_ROOT, pdf)), report.padStart(3, "0"));
  }
  return out;
}

/** Tailored PDFs in career-ops output/ (recursive), newest first, with the report they belong to. */
export function listTailored() {
  const root = p("output");
  const index = pdfIndex();
  const out: Array<{ file: string; name: string; mtime: number; report?: string }> = [];
  const walk = (dir: string, depth: number) => {
    if (!existsSync(dir) || depth > 6) return;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, f.name);
      if (f.isDirectory()) walk(full, depth + 1);
      else if (f.name.toLowerCase().endsWith(".pdf") && !/cover/i.test(f.name)) {
        const rel = relative(CAREER_OPS_ROOT, full);
        out.push({ file: rel, name: relative(root, full), mtime: statSync(full).mtimeMs, report: index.get(rel) });
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}
