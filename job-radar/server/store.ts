import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import type { Job, Settings, Tracking } from "../shared/types";

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.JOB_RADAR_DATA || resolve(APP_ROOT, "data");

const file = (name: string) => resolve(DATA_DIR, name);

function readJson<T>(name: string, fallback: T): T {
  const p = file(name);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write: temp file + rename, so a crash never leaves half-written JSON. */
function writeJson(name: string, data: unknown) {
  const p = file(name);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, p);
}

/** Deep-merges saved settings over defaults so new setting keys appear after upgrades. */
function mergeDefaults<T>(def: T, saved: unknown): T {
  if (Array.isArray(def)) return (Array.isArray(saved) ? saved : def) as T;
  if (def && typeof def === "object") {
    const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    if (saved && typeof saved === "object") {
      for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        out[k] = k in out ? mergeDefaults((def as Record<string, unknown>)[k], v) : v;
      }
    }
    return out as T;
  }
  return (saved === undefined ? def : saved) as T;
}

export const store = {
  getJobs(): Record<string, Job> {
    // First run: start from the jobs collected in the initial manual scrape (seed/), until a real scrape saves jobs.json.
    const seed = resolve(APP_ROOT, "seed", "jobs.seed.json");
    if (!process.env.JOB_RADAR_DATA && !existsSync(file("jobs.json")) && existsSync(seed)) return JSON.parse(readFileSync(seed, "utf-8"));
    return readJson<Record<string, Job>>("jobs.json", {});
  },
  saveJobs(jobs: Record<string, Job>) {
    writeJson("jobs.json", jobs);
  },
  getSettings(): Settings {
    return mergeDefaults(DEFAULT_SETTINGS, readJson<unknown>("settings.json", {}));
  },
  saveSettings(s: Settings) {
    writeJson("settings.json", s);
  },
  getTracking(): Record<string, Tracking> {
    return readJson<Record<string, Tracking>>("tracking.json", {});
  },
  saveTracking(t: Record<string, Tracking>) {
    writeJson("tracking.json", t);
  },
};
