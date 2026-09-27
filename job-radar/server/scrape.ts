import type { Job, ScrapeStatus, SourceConfig } from "../shared/types";
import { isAllowed, robotsFor } from "./robots";
import * as generic from "./sources/generic";
import * as jsguru from "./sources/jsgurujobs";
import { store } from "./store";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) job-radar/0.1 (personal job search; respects robots.txt)";

export type ScrapeMode = "quick" | "full";

export const status: ScrapeStatus = { running: false, done: 0, total: 0, added: 0, updated: 0, gone: 0, errors: 0, log: [] };
let cancelRequested = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(msg: string) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  status.log.push(line);
  if (status.log.length > 300) status.log.splice(0, status.log.length - 300);
  console.log(`[scrape] ${msg}`);
}

async function fetchText(url: string): Promise<{ status: number; text: string; finalUrl: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal, redirect: "follow" });
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      return { status: res.status, text, finalUrl: res.url };
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error("unreachable");
}

const isJsguru = (url: string) => new URL(url).hostname.replace(/^www\./, "") === jsguru.HOST;

export function supportedHost(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Which extractor a link will use — shown next to each source in Settings. */
export async function detectSource(url: string): Promise<{ kind: "jsgurujobs" | "provider" | "generic"; provider?: string }> {
  if (isJsguru(url)) return { kind: "jsgurujobs" };
  const p = await generic.providerFor(url);
  return p ? { kind: "provider", provider: p.id } : { kind: "generic" };
}

export function cancelScrape() {
  if (status.running) cancelRequested = true;
}

/**
 * Scrapes one source.
 *  - quick: reads the listing page(s) of the link you gave and fetches jobs not seen yet.
 *  - full:  also sweeps job IDs below the newest one (detail pages are allowed by robots.txt,
 *           the site's /api and most paginated listings are not), refreshing stale jobs.
 */
export async function runScrape(source: SourceConfig, mode: ScrapeMode) {
  if (status.running) throw new Error("A scrape is already running");
  if (!supportedHost(source.url)) throw new Error(`Not a web link: ${source.url}`);

  Object.assign(status, {
    running: true,
    sourceId: source.id,
    phase: "listing",
    done: 0,
    total: 0,
    added: 0,
    updated: 0,
    gone: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    log: [],
  });
  cancelRequested = false;

  const jobs = store.getJobs();
  const nowIso = new Date().toISOString();
  const persist = () => store.saveJobs(jobs);
  try {
    if (isJsguru(source.url)) await scrapeJsguru(source, mode, jobs, nowIso, persist);
    else await scrapeGeneric(source, mode, jobs, nowIso, persist);
    persist();
    log(`done: +${status.added} new, ${status.updated} refreshed, ${status.gone} gone, ${status.errors} errors`);
  } catch (e) {
    status.errors++;
    log(`failed: ${(e as Error).message}`);
    persist();
  } finally {
    status.running = false;
    status.phase = "idle";
    status.finishedAt = new Date().toISOString();
  }
}

/** robots.txt check for any URL (cached per origin). */
async function allowedUrl(u: string) {
  return isAllowed(await robotsFor(new URL(u).origin, fetchText), u);
}

async function scrapeJsguru(source: SourceConfig, mode: ScrapeMode, jobs: Record<string, Job>, nowIso: string, persist: () => void) {
  const origin = new URL(source.url).origin;
  const robots = await robotsFor(origin, fetchText);
  const allowed = (u: string) => isAllowed(robots, u);
  let sinceSave = 0;
  // 1) Listing pages from the link you provided (+ pagination the site allows).
  const ids = new Set<number>();
  const queue = [source.url];
  const seenPages = new Set<string>();
  while (queue.length && seenPages.size < 15 && !cancelRequested) {
    const page = queue.shift()!;
    if (seenPages.has(page)) continue;
    seenPages.add(page);
    if (!allowed(page)) {
      log(`skip (robots.txt): ${page}`);
      continue;
    }
    const res = await fetchText(page);
    if (res.status !== 200) {
      log(`listing ${page} -> HTTP ${res.status}`);
      continue;
    }
    const parsed = jsguru.parseListing(res.text);
    parsed.ids.forEach((i) => ids.add(i));
    log(`listing ${page}: ${parsed.ids.length} jobs`);
    for (const p of parsed.nextPages) if (!seenPages.has(p)) queue.push(p);
    await sleep(source.delayMs);
  }
  if (!ids.size) throw new Error("No jobs found on the listing page — the site layout may have changed");

  // 2) Decide which detail pages to fetch.
  const maxId = Math.max(...ids);
  const staleMs = source.refreshAfterDays * 86_400_000;
  const candidates = new Set<number>(ids);
  if (mode === "full") for (let i = maxId; i > Math.max(0, maxId - source.sweepDepth); i--) candidates.add(i);
  const todo = [...candidates]
    .sort((a, b) => b - a)
    .filter((id) => {
      const j = jobs[`jsgurujobs:${id}`];
      if (!j) return true;
      if (j.status === "gone") return false;
      return Date.now() - new Date(j.lastFetchedAt).getTime() > staleMs;
    });
  status.total = todo.length;
  status.phase = "details";
  log(`newest job id ${maxId}; fetching ${todo.length} job pages (${mode} scan)`);

  // 3) Fetch + parse detail pages, politely, one at a time.
  for (const id of todo) {
    if (cancelRequested) {
      log("cancelled");
      break;
    }
    const url = `${origin}/jobs/${id}`;
    const key = `jsgurujobs:${id}`;
    try {
      if (!allowed(url)) {
        log(`skip (robots.txt): ${url}`);
      } else {
        const res = await fetchText(url);
        const job = res.status === 200 && !/\/jobs\/?$/.test(new URL(res.finalUrl).pathname) ? jsguru.parseJobPage(res.text, String(id), nowIso) : null;
        if (job) {
          const prev = jobs[key];
          if (prev) {
            jobs[key] = { ...job, firstSeenAt: prev.firstSeenAt };
            status.updated++;
          } else {
            jobs[key] = job;
            status.added++;
            log(`+ ${job.title} — ${job.company}`);
          }
        } else if (res.status === 404 || res.status === 410 || res.status === 200) {
          if (jobs[key] && jobs[key].status !== "gone") {
            jobs[key] = { ...jobs[key], status: "gone", lastFetchedAt: nowIso };
            status.gone++;
            log(`- gone: ${jobs[key].title}`);
          }
        } else {
          status.errors++;
          log(`HTTP ${res.status} for ${url}`);
        }
      }
    } catch (e) {
      status.errors++;
      log(`error ${url}: ${(e as Error).message}`);
    }
    status.done++;
    if (++sinceSave >= 10) {
      persist();
      sinceSave = 0;
    }
    await sleep(source.delayMs);
  }
  // Jobs still on the listing are "seen".
  for (const id of ids) {
    const j = jobs[`jsgurujobs:${id}`];
    if (j) j.lastSeenAt = nowIso;
  }
}

/**
 * Any other site. Listing: a career-ops provider (ATS/board API) if one recognises the link, else the page's
 * links (+ ?page=N pagination up to maxPages), else career-ops' headless browser. Job pages: schema.org
 * JobPosting JSON-LD. Only jobs whose link text matches titleKeywords are fetched (all when empty).
 */
async function scrapeGeneric(source: SourceConfig, mode: ScrapeMode, jobs: Record<string, Job>, nowIso: string, persist: () => void) {
  let found: generic.Candidate[] = [];
  const provider = await generic.providerFor(source.url);
  if (provider) {
    log(`using career-ops provider "${provider.id}"`);
    found = await provider.list();
  } else {
    const queue = [source.url];
    const seen = new Set<string>();
    while (queue.length && seen.size < Math.max(1, source.maxPages ?? 3) && !cancelRequested) {
      const page = queue.shift()!;
      if (seen.has(page)) continue;
      seen.add(page);
      if (!(await allowedUrl(page))) {
        log(`skip (robots.txt): ${page}`);
        continue;
      }
      const res = await fetchText(page);
      if (res.status !== 200) {
        log(`listing ${page} -> HTTP ${res.status}`);
        continue;
      }
      const parsed = generic.extractLinks(res.text, res.finalUrl);
      found.push(...parsed.links);
      log(`listing ${page}: ${parsed.links.length} links`);
      queue.push(...parsed.nextPages.filter((p) => !seen.has(p)).sort((a, b) => a.length - b.length || a.localeCompare(b)));
      await sleep(source.delayMs);
    }
    if (!found.length && !cancelRequested) {
      log("no links in the page HTML (JS-rendered?) — trying career-ops' headless browser");
      found = await generic.browserListing(source.url);
    }
  }
  found = [...new Map(found.map((c) => [c.url, c])).values()];
  const words = (l?: string[]) => (l ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  const kws = words(source.titleKeywords);
  const excl = words(source.titleExclude);
  const wanted = found.filter((c) => {
    const t = c.label.toLowerCase();
    if (excl.some((k) => t.includes(k))) return false;
    return !kws.length || !t || kws.some((k) => t.includes(k));
  });
  if (!found.length) throw new Error("No job links found on that page");
  log(`${found.length} postings listed${kws.length || excl.length ? `, ${wanted.length} pass your title filters` : ""}`);

  const staleMs = source.refreshAfterDays * 86_400_000;
  const todo = wanted
    .filter((c) => {
      const j = jobs[generic.jobKey(source.id, c.url)];
      if (!j) return true;
      j.lastSeenAt = nowIso;
      return mode === "full" && j.status !== "gone" && Date.now() - new Date(j.lastFetchedAt).getTime() > staleMs;
    })
    .slice(0, Math.max(1, source.sweepDepth));
  status.total = todo.length;
  status.phase = "details";
  log(`fetching ${todo.length} job pages (${mode} scan${todo.length === source.sweepDepth ? `, capped at ${source.sweepDepth}` : ""})`);

  let noSchema = 0;
  let sinceSave = 0;
  for (const c of todo) {
    if (cancelRequested) {
      log("cancelled");
      break;
    }
    const key = generic.jobKey(source.id, c.url);
    try {
      if (!(await allowedUrl(c.url))) log(`skip (robots.txt): ${c.url}`);
      else {
        const res = await fetchText(c.url);
        const job =
          res.status === 200 ? generic.parseJobPosting(res.text, c.url, source.id, nowIso) ?? (provider ? generic.fallbackJob(c, res.text, source.id, nowIso) : null) : null;
        if (job) {
          if (!job.company && c.company) job.company = c.company;
          if (!job.location && c.location) job.location = c.location;
          const prev = jobs[key];
          jobs[key] = prev ? { ...job, firstSeenAt: prev.firstSeenAt } : job;
          if (prev) status.updated++;
          else {
            status.added++;
            log(`+ ${job.title} — ${job.company}`);
          }
        } else if (res.status === 404 || res.status === 410) {
          if (jobs[key] && jobs[key].status !== "gone") {
            jobs[key] = { ...jobs[key], status: "gone", lastFetchedAt: nowIso };
            status.gone++;
          }
        } else if (res.status === 200) noSchema++;
        else {
          status.errors++;
          log(`HTTP ${res.status} for ${c.url}`);
        }
      }
    } catch (e) {
      status.errors++;
      log(`error ${c.url}: ${(e as Error).message}`);
    }
    status.done++;
    if (++sinceSave >= 10) {
      persist();
      sinceSave = 0;
    }
    await sleep(source.delayMs);
  }
  if (noSchema) log(`${noSchema} page(s) had no JobPosting data and were skipped (not job pages, or the site doesn't publish it)`);
}

export type { Job };
