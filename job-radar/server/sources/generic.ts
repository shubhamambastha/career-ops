// Any job site: career-ops' own provider layer (Greenhouse, Lever, Ashby, Workable, Workday, 80+ boards)
// when it recognises the link, otherwise the page's links + schema.org JobPosting JSON-LD on each job page
// (what Google Jobs reads, so most boards ship it). JS-only listings fall back to career-ops' Playwright reader.

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Job } from "../../shared/types";
import { CAREER_OPS_ROOT } from "../careerops";
import { parseJson, run } from "../proc";
import { EMAIL_RE, IGNORED_EMAIL, extractMinYears } from "./jsgurujobs";

export interface Candidate {
  url: string;
  label: string;
  company?: string;
  location?: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const depth = (path: string) => path.split("/").filter(Boolean).length;

export const jobKey = (sourceId: string, url: string) => `${sourceId}:${createHash("sha1").update(url).digest("hex").slice(0, 12)}`;

// ---- career-ops providers ------------------------------------------------------------------

type Provider = { id: string; fetch: (entry: object, ctx: object) => Promise<Array<{ title: string; url: string; company?: string; location?: string }>> };
let loaded: Promise<{ providers: Map<string, Provider>; resolveProvider: Function; makeHttpCtx: () => object }> | null = null;

function careerOpsProviders() {
  loaded ??= (async () => {
    const mod = (f: string) => import(pathToFileURL(resolve(CAREER_OPS_ROOT, "providers", f)).href);
    const [reg, http] = await Promise.all([mod("_registry.mjs"), mod("_http.mjs")]);
    return { providers: await reg.loadProviders(resolve(CAREER_OPS_ROOT, "providers")), resolveProvider: reg.resolveProvider, makeHttpCtx: http.makeHttpCtx };
  })();
  return loaded;
}

/** The career-ops provider that handles this link, if any (local-parser excluded: it runs commands). */
export async function providerFor(url: string): Promise<{ id: string; list: () => Promise<Candidate[]> } | null> {
  let lib;
  try {
    lib = await careerOpsProviders();
  } catch {
    return null; // not inside career-ops
  }
  // ATS links carry the company in the first path segment (job-boards.greenhouse.io/anthropic); boards set it per row.
  const u = new URL(url);
  const slug = u.pathname.split("/").filter(Boolean)[0] || u.hostname.replace(/^www\./, "");
  const entry = { name: slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), careers_url: url };
  const hit = lib.resolveProvider(entry, lib.providers, { skipIds: ["local-parser"] });
  if (!hit?.provider) return null;
  const p: Provider = hit.provider;
  return {
    id: p.id,
    list: async () => (await p.fetch(entry, lib.makeHttpCtx())).map((r) => ({ url: r.url, label: r.title, company: r.company, location: r.location })),
  };
}

// ---- Listing pages -----------------------------------------------------------------------

const ASSET = /\.(css|js|png|jpe?g|gif|svg|webp|ico|pdf|xml|json|txt|woff2?)$/i;
const NAV = /\/(sign[-_]?in|sign[-_]?up|log[-_]?in|register|privacy|terms|cookies?|about|contact|blog|pricing|faq|help)\b/i;

/** Links on a listing page that could be job pages, plus pagination links. */
export function extractLinks(html: string, pageUrl: string): { links: Candidate[]; nextPages: string[] } {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const all: Candidate[] = [];
  const nextPages = new Set<string>();
  $("a[href]").each((_, a) => {
    let u: URL;
    try {
      u = new URL($(a).attr("href")!, base);
    } catch {
      return;
    }
    if (u.origin !== base.origin || ASSET.test(u.pathname)) return;
    u.hash = "";
    if (u.pathname === base.pathname) {
      if (/[?&](page|p|offset|start)=\d+/i.test(u.search)) nextPages.add(u.href);
      return;
    }
    if (!NAV.test(u.pathname)) all.push({ url: u.href, label: oneLine($(a).text()) });
  });
  return { links: filterCandidates(all, pageUrl), nextPages: [...nextPages] };
}

/** Keeps links deeper than the listing (…/jobs → …/jobs/123); relaxes to job-ish links if that finds none. */
export function filterCandidates(links: Candidate[], pageUrl: string): Candidate[] {
  const base = new URL(pageUrl);
  const byUrl = new Map<string, Candidate>();
  for (const l of links) {
    const prev = byUrl.get(l.url);
    if (!prev || l.label.length > prev.label.length) byUrl.set(l.url, l);
  }
  const uniq = [...byUrl.values()].filter((l) => new URL(l.url).origin === base.origin);
  const deeper = uniq.filter((l) => depth(new URL(l.url).pathname) > depth(base.pathname));
  return deeper.length ? deeper : uniq.filter((l) => /job|career|position|opening|vacanc|\d{3,}/i.test(new URL(l.url).pathname));
}

/** JS-rendered listings: career-ops' headless reader (browser-extract.mjs, read-only Playwright). */
export async function browserListing(url: string): Promise<Candidate[]> {
  const r = await run(process.execPath, ["browser-extract.mjs", url, "--mode", "listing"], { cwd: CAREER_OPS_ROOT, timeoutMs: 60_000 });
  const out = parseJson(r.stdout) as { jobs?: Array<{ title: string; url: string }>; error?: string } | null;
  if (!out?.jobs) throw new Error(out?.error || r.stderr.trim() || "browser-extract returned nothing");
  return filterCandidates(
    out.jobs.map((j) => ({ url: j.url.replace(/#.*$/, ""), label: j.title })),
    url,
  ).filter((l) => !NAV.test(new URL(l.url).pathname) && !ASSET.test(new URL(l.url).pathname));
}

// ---- Job pages -----------------------------------------------------------------------------

function findJobPosting(node: unknown): Record<string, any> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n);
      if (hit) return hit;
    }
    return null;
  }
  const o = node as Record<string, any>;
  const type = o["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return o;
  return findJobPosting(o["@graph"]);
}

const name = (v: any): string => (typeof v === "string" ? v : v?.name || "");
const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function htmlToText(html: string): { text: string; html: string } {
  // Some sites double-escape the description (&lt;p&gt;…).
  const decoded = /&lt;\/?[a-z]/i.test(html) ? cheerio.load(html).text() : html;
  const $ = cheerio.load(decoded);
  $("br").replaceWith("\n");
  $("p, li, h1, h2, h3, h4, div").each((_, el) => void $(el).append("\n"));
  $("li").each((_, el) => void $(el).prepend("• "));
  return { text: clean($.root().text()), html: decoded };
}

function salaryText(s: any): string {
  if (!s) return "";
  if (typeof s === "string") return s;
  const v = s.value ?? {};
  const range = v.minValue && v.maxValue ? `${v.minValue}–${v.maxValue}` : v.value ?? v.minValue ?? v.maxValue ?? (typeof v === "number" ? v : "");
  return range === "" ? "" : oneLine(`${s.currency || v.currency || ""} ${range} ${v.unitText ? `/ ${String(v.unitText).toLowerCase()}` : ""}`);
}

/** Parses the schema.org JobPosting on a job page. Returns null when the page has none. */
export function parseJobPosting(html: string, url: string, sourceId: string, nowIso = new Date().toISOString()): Job | null {
  const $ = cheerio.load(html);
  let jp: Record<string, any> | null = null;
  $('script[type="application/ld+json"]').each((_, s) => {
    if (jp) return;
    try {
      jp = findJobPosting(JSON.parse($(s).text()));
    } catch {
      /* malformed block */
    }
  });
  if (!jp) return null;
  const j = jp as Record<string, any>;
  const title = oneLine(cheerio.load(String(j.title || "")).text());
  if (!title) return null;

  const { text, html: descHtml } = htmlToText(String(j.description || ""));
  const places = list(j.jobLocation).map((l: any) => {
    const a = l?.address ?? {};
    return typeof a === "string" ? a : [a.addressLocality, a.addressRegion, name(a.addressCountry)].filter(Boolean).join(", ");
  });
  const remote = /telecommute/i.test(String(j.jobLocationType || ""));
  const allowed = list(j.applicantLocationRequirements).map(name).filter(Boolean);
  const location = [remote ? `Remote${allowed.length ? ` (${allowed.join(", ")})` : ""}` : "", ...places].filter(Boolean).join(" · ");
  const months = Number(j.experienceRequirements?.monthsOfExperience);
  const skills = list<string>(j.skills)
    .flatMap((s) => String(s).split(/[,;•\n]/))
    .map(oneLine)
    .filter((s) => s && s.length < 40);
  const emails = [...new Set([...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()))].filter((e) => !IGNORED_EMAIL.test(e));
  const org = j.hiringOrganization;

  return {
    id: jobKey(sourceId, url),
    source: sourceId,
    sourceId: jobKey(sourceId, url).split(":")[1],
    url,
    title,
    company: oneLine(name(org)),
    location,
    workFormat: remote || /remote/i.test(location) ? ["Remote"] : /hybrid/i.test(`${location} ${title}`) ? ["Hybrid"] : places.length ? ["Onsite"] : [],
    jobType: list(j.employmentType).map((t) => String(t).replace(/_/g, " ").toLowerCase()).join(", "),
    salaryText: salaryText(j.baseSalary ?? j.estimatedSalary),
    postedAt: /^\d{4}-\d{2}-\d{2}/.test(String(j.datePosted || "")) ? String(j.datePosted).slice(0, 10) : null,
    skills,
    descriptionText: text,
    descriptionHtml: descHtml,
    whoFor: "",
    summary: "",
    minYears: months > 0 ? Math.round(months / 12) : extractMinYears(text),
    emails,
    applyLinks: [url],
    status: j.validThrough && Date.parse(j.validThrough) < Date.now() ? "gone" : "open",
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    lastFetchedAt: nowIso,
  };
}

/** A job we already know from a provider feed, when its page has no JSON-LD: keep the page's visible text. */
export function fallbackJob(c: Candidate, html: string, sourceId: string, nowIso = new Date().toISOString()): Job {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, svg").remove();
  const text = clean(($("main").text() || $("body").text()).slice(0, 20_000));
  return {
    id: jobKey(sourceId, c.url),
    source: sourceId,
    sourceId: jobKey(sourceId, c.url).split(":")[1],
    url: c.url,
    title: c.label,
    company: c.company || "",
    location: c.location || "",
    workFormat: /remote/i.test(c.location || "") ? ["Remote"] : [],
    jobType: "",
    salaryText: "",
    postedAt: null,
    skills: [],
    descriptionText: text,
    descriptionHtml: "",
    whoFor: "",
    summary: "",
    minYears: extractMinYears(text),
    emails: [...new Set([...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()))].filter((e) => !IGNORED_EMAIL.test(e)),
    applyLinks: [c.url],
    status: "open",
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    lastFetchedAt: nowIso,
  };
}
