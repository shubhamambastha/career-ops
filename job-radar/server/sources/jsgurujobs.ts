import * as cheerio from "cheerio";
import type { Job } from "../../shared/types";

export const HOST = "jsgurujobs.com";
const BASE = "https://jsgurujobs.com";

const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "July 26, 2026" -> "2026-07-26" */
export function parseDate(s: string): string | null {
  const m = s.trim().match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Finds the smallest "N+ years" / "N-M years" / "at least N years" requirement in the text. */
export function extractMinYears(text: string): number | null {
  const t = text.toLowerCase();
  const found: number[] = [];
  const patterns = [
    /(\d{1,2})\s*\+\s*(?:years|yrs)/g,
    /(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*(?:years|yrs)/g,
    /(?:at least|minimum of|minimum|min\.?)\s*(\d{1,2})\s*(?:years|yrs)/g,
    /(\d{1,2})\s*(?:years|yrs)\s*(?:of\s+)?(?:professional\s+|commercial\s+|hands-on\s+|relevant\s+)?experience/g,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 20) found.push(n);
    }
  }
  return found.length ? Math.min(...found) : null;
}

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export const IGNORED_EMAIL = /(jsgurujobs\.com|example\.com|sentry|wixpress|\.png|\.jpg)$/i;
const ATS_RE = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jobvite\.com|myworkdayjobs\.com|personio\.|jobs\.|careers\.|\/careers|\/jobs\/|apply)/i;

/** Parses a job detail page (https://jsgurujobs.com/jobs/{id}). Returns null when it isn't a job page. */
export function parseJobPage(html: string, sourceId: string, nowIso = new Date().toISOString()): Job | null {
  const $ = cheerio.load(html);
  const title = oneLine($("h1").first().text());
  if (!title) return null;
  const company = oneLine($("h1").first().nextAll("p").first().text());

  const fields: Record<string, cheerio.Cheerio<any>> = {};
  $("dl dt").each((_, dt) => {
    fields[oneLine($(dt).text()).toLowerCase()] = $(dt).next("dd");
  });
  const field = (k: string) => (fields[k] ? oneLine(fields[k].text()) : "");
  const workFormat = fields["work format"]
    ? fields["work format"]
        .find("span")
        .map((_, el) => oneLine($(el).text()).replace(/^[^\p{L}]+/u, ""))
        .get()
        .filter(Boolean)
    : [];

  // Sections are keyed by their h3 heading ("Job Description", "🎯 Who is this job for?", "📋 Job Summary"...).
  const section = (re: RegExp) => {
    const h = $("h3")
      .filter((_, el) => re.test($(el).text()))
      .first();
    if (!h.length) return null;
    return h.closest("div").parent().children("div.border-t").first();
  };
  const descEl = section(/job description/i);
  const descriptionHtml = descEl ? (descEl.html() || "").trim() : "";
  const descriptionText = descEl ? clean(descEl.text()) : "";
  const whoFor = oneLine(section(/who is this job for/i)?.text() || "");
  const summary = oneLine(section(/job summary/i)?.text() || "");

  const skillsHeader = $("h2").filter((_, el) => /required skills/i.test($(el).text())).first();
  const skills = skillsHeader.length
    ? skillsHeader
        .next("div")
        .find("span")
        .map((_, el) => oneLine($(el).text()))
        .get()
        .filter(Boolean)
    : [];

  const emails = new Set<string>();
  descEl?.find('a[href^="mailto:"]').each((_, a) => {
    const addr = ($(a).attr("href") || "").replace(/^mailto:/i, "").split("?")[0];
    if (addr) emails.add(decodeURIComponent(addr).toLowerCase());
  });
  for (const m of descriptionText.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());

  const applyLinks = new Set<string>();
  descEl?.find("a[href^='http']").each((_, a) => {
    const href = $(a).attr("href") || "";
    const txt = $(a).text();
    if (!href.includes(HOST) && (ATS_RE.test(href) || /apply/i.test(txt))) applyLinks.add(href);
  });

  return {
    id: `jsgurujobs:${sourceId}`,
    source: "jsgurujobs",
    sourceId,
    url: `${BASE}/jobs/${sourceId}`,
    title,
    company,
    location: field("location"),
    workFormat,
    jobType: field("job type"),
    salaryText: field("salary"),
    postedAt: parseDate(field("posted")),
    skills,
    descriptionText,
    descriptionHtml,
    whoFor,
    summary,
    minYears: extractMinYears(`${whoFor}\n${descriptionText}`),
    emails: [...emails].filter((e) => !IGNORED_EMAIL.test(e)),
    applyLinks: [...applyLinks].slice(0, 5),
    status: "open",
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    lastFetchedAt: nowIso,
  };
}

/** Collects job IDs and pagination links from a listing page (/jobs, /in/jobs, /in/stack/react ...). */
export function parseListing(html: string): { ids: number[]; nextPages: string[] } {
  const $ = cheerio.load(html);
  const ids = new Set<number>();
  $("a[href]").each((_, a) => {
    const m = ($(a).attr("href") || "").match(/jsgurujobs\.com\/jobs\/(\d+)(?:$|[?#])|^\/jobs\/(\d+)(?:$|[?#])/);
    if (m) ids.add(parseInt(m[1] || m[2], 10));
  });
  const nextPages = new Set<string>();
  $('a[href*="page="]').each((_, a) => {
    const href = $(a).attr("href");
    if (href) nextPages.add(new URL(href, BASE).toString());
  });
  return { ids: [...ids], nextPages: [...nextPages] };
}
