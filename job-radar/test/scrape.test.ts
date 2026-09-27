import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Isolated data dir so the test never touches real data.
process.env.JOB_RADAR_DATA = mkdtempSync(join(tmpdir(), "job-radar-test-"));

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf-8");
const requested: string[] = [];

globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  requested.push(url);
  const ok = (text: string) => ({ status: 200, url, text: async () => text }) as unknown as Response;
  if (url.endsWith("/robots.txt")) return ok("User-agent: *\nDisallow: /api/\nDisallow: /*/jobs?*page=*\n");
  if (url === "https://jsgurujobs.com/in/jobs") return ok(`<a href="https://jsgurujobs.com/jobs/544">x</a><a href="https://jsgurujobs.com/in/jobs?page=2">2</a>`);
  if (url === "https://jsgurujobs.com/jobs/544") return ok(fx("jsguru-544.html"));
  if (url === "https://jsgurujobs.com/jobs/543") return ok(fx("jsguru-544.html").replace("HighLevel</p>", "OtherCo</p>"));
  if (url === "https://board.test/jobs/all" || url === "https://board.test/jobs/all?page=2")
    return ok(`<a href="/jobs/acme/backend-engineer-1">Backend Engineer</a><a href="/jobs/acme/sales-rep-2">Sales Rep</a><a href="/jobs/sign-in">Sign in</a><a href="/jobs/all?page=2">2</a><a href="/jobs/acme/about-3">Senior Engineer blog</a><a href="/jobs/acme/intern-4">Engineer Intern</a>`);
  if (url === "https://board.test/jobs/acme/backend-engineer-1")
    return ok(`<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "JobPosting", title: "Backend Engineer", description: "&lt;p&gt;Node.js, 4+ years. Mail jobs@acme.io&lt;/p&gt;", datePosted: "2026-09-01", hiringOrganization: { name: "Acme" }, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: [{ name: "India" }], baseSalary: { currency: "USD", value: { minValue: 50000, maxValue: 70000, unitText: "YEAR" } } }] })}</script>`);
  if (url === "https://board.test/jobs/acme/about-3") return ok("<h1>Not a job</h1>");
  return { status: 404, url, text: async () => "not found" } as unknown as Response;
}) as typeof fetch;

test("full scrape: respects robots, parses, sweeps, persists", async () => {
  const { runScrape, status } = await import("../server/scrape");
  const { store } = await import("../server/store");
  await runScrape({ id: "t", url: "https://jsgurujobs.com/in/jobs", enabled: true, sweepDepth: 3, delayMs: 0, refreshAfterDays: 7 }, "full");
  assert.ok(!requested.includes("https://jsgurujobs.com/in/jobs?page=2"), "disallowed pagination must not be fetched");
  const jobs = store.getJobs();
  assert.equal(jobs["jsgurujobs:544"].company, "HighLevel");
  assert.equal(jobs["jsgurujobs:543"].company, "OtherCo");
  assert.equal(jobs["jsgurujobs:542"], undefined);
  assert.equal(status.added, 2);
  assert.equal(status.running, false);

  // Second quick run: nothing stale, nothing new.
  requested.length = 0;
  await runScrape({ id: "t", url: "https://jsgurujobs.com/in/jobs", enabled: true, sweepDepth: 3, delayMs: 0, refreshAfterDays: 7 }, "quick");
  assert.equal(status.added, 0);
  assert.ok(!requested.some((u) => /\/jobs\/\d+$/.test(u)), "fresh jobs are not re-fetched");
});

test("any site: links + JSON-LD JobPosting, title filter, pagination", async () => {
  const { runScrape, status, detectSource } = await import("../server/scrape");
  const { store } = await import("../server/store");
  assert.deepEqual(await detectSource("https://board.test/jobs/all"), { kind: "generic" });
  requested.length = 0;
  await runScrape({ id: "board", url: "https://board.test/jobs/all", enabled: true, sweepDepth: 10, delayMs: 0, refreshAfterDays: 7, maxPages: 2, titleKeywords: ["engineer"], titleExclude: ["Intern"] }, "quick");
  assert.ok(requested.includes("https://board.test/jobs/all?page=2"), "follows pagination");
  assert.ok(!requested.some((u) => /sales-rep|sign-in|intern-4/.test(u)), "title filters and nav links skip fetches");
  const job = Object.values(store.getJobs()).find((j) => j.source === "board")!;
  assert.equal(job.company, "Acme");
  assert.equal(job.location, "Remote (India)");
  assert.equal(job.postedAt, "2026-09-01");
  assert.equal(job.minYears, 4);
  assert.deepEqual(job.emails, ["jobs@acme.io"]);
  assert.match(job.salaryText, /USD 50000–70000/);
  assert.equal(status.added, 1);
});
