import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import { classifyLocation, pickResume, renderTemplate, scoreJob } from "../shared/scoring";
import type { Job } from "../shared/types";
import { isAllowed, parseRobots } from "../server/robots";
import { extractMinYears, parseJobPage, parseListing } from "../server/sources/jsgurujobs";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf-8");

test("parses a jsgurujobs detail page", () => {
  const job = parseJobPage(fx("jsguru-544.html"), "544", "2026-09-25T00:00:00.000Z")!;
  assert.equal(job.title, "Software Development Engineer III - Custom Objects (Backend)");
  assert.equal(job.company, "HighLevel");
  assert.equal(job.location, "India");
  assert.deepEqual(job.workFormat, ["Remote", "APAC"]);
  assert.equal(job.jobType, "full-time");
  assert.equal(job.salaryText, "Not specified");
  assert.equal(job.postedAt, "2026-07-26");
  assert.deepEqual(job.skills, ["Node.js", "TypeScript", "NestJS", "Vue.js", "MongoDB", "Redis", "GCP", "Kubernetes"]);
  assert.equal(job.minYears, 4);
  assert.deepEqual(job.emails, ["talent@gohighlevel.com"]);
  assert.deepEqual(job.applyLinks, ["https://jobs.lever.co/gohighlevel/123"]);
  assert.match(job.whoFor, /Senior-level/);
  assert.match(job.summary, /remote role based in India/);
  assert.ok(!job.descriptionText.includes("Related jobs"));
});

test("parses listing ids and pagination", () => {
  const { ids, nextPages } = parseListing(fx("jsguru-listing.html"));
  assert.deepEqual(ids.sort(), [571, 579]);
  assert.deepEqual(nextPages, ["https://jsgurujobs.com/in/stack/react?page=2"]);
});

test("extracts minimum years", () => {
  assert.equal(extractMinYears("7+ years as a software engineer"), 7);
  assert.equal(extractMinYears("5–8 years of experience"), 5);
  assert.equal(extractMinYears("at least 3 years with React; 10+ years preferred"), 3);
  assert.equal(extractMinYears("no requirement"), null);
});

test("robots.txt rules match jsgurujobs behaviour", () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /api/\nDisallow: /*/jobs?*page=*\nDisallow: /jobs?*page=*\nDisallow: /login\n\nUser-agent: BadBot\nDisallow: /`);
  assert.equal(isAllowed(rules, "https://jsgurujobs.com/jobs/544"), true);
  assert.equal(isAllowed(rules, "https://jsgurujobs.com/jobs"), true);
  assert.equal(isAllowed(rules, "https://jsgurujobs.com/api/jobs"), false);
  assert.equal(isAllowed(rules, "https://jsgurujobs.com/jobs?page=2"), false);
  assert.equal(isAllowed(rules, "https://jsgurujobs.com/in/jobs?page=2"), false);
  assert.equal(isAllowed(rules, "https://jsgurujobs.com/in/stack/react?page=2"), true);
});

const base = (over: Partial<Job>): Job => ({
  id: "t:1", source: "t", sourceId: "1", url: "https://x/1", title: "Senior Backend Engineer", company: "Acme",
  location: "", workFormat: [], jobType: "full-time", salaryText: "", postedAt: "2026-09-20", skills: ["Node.js", "TypeScript", "PostgreSQL"],
  descriptionText: "", descriptionHtml: "", whoFor: "", summary: "", minYears: 5, emails: [], applyLinks: [], status: "open",
  firstSeenAt: "", lastSeenAt: "", lastFetchedAt: "", ...over,
});

test("location eligibility", () => {
  const L = DEFAULT_SETTINGS.scoring.location;
  assert.equal(classifyLocation(base({ location: "India", workFormat: ["Remote", "APAC"] }), L).eligibility, "remote_ok");
  assert.equal(classifyLocation(base({ location: "Bengaluru, India" }), L).eligibility, "home_onsite");
  assert.equal(classifyLocation(base({ location: "Remote, USA", workFormat: ["Remote"], descriptionText: "US only" }), L).eligibility, "blocked");
  assert.equal(classifyLocation(base({ location: "Remote", workFormat: ["Remote", "Worldwide"] }), L).eligibility, "remote_ok");
  assert.equal(classifyLocation(base({ location: "Remote", workFormat: ["Remote"] }), L).eligibility, "unclear");
  assert.equal(classifyLocation(base({ location: "Berlin, Germany", workFormat: ["Onsite"] }), L).eligibility, "blocked");
});

test("scores a strong match high and a junior/blocked one low", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const good = scoreJob(base({ location: "India", workFormat: ["Remote"], skills: ["Node.js", "NestJS", "PostgreSQL", "AWS"] }), DEFAULT_SETTINGS, now);
  const bad = scoreJob(
    base({ title: "Junior PHP Developer", location: "Austin, US", workFormat: ["Onsite"], skills: ["PHP", "Laravel"], minYears: 0, postedAt: "2025-01-01" }),
    DEFAULT_SETTINGS,
    now,
  );
  assert.ok(good.total >= 85, `good=${good.total}`);
  assert.equal(good.tier, "A");
  assert.ok(bad.total < 30, `bad=${bad.total}`);
  assert.deepEqual(bad.missingSkills, ["PHP", "Laravel"]);
});

test("picks the matching resume", () => {
  const be = pickResume(base({ skills: ["Node.js", "NestJS", "Redis"] }), "backend", DEFAULT_SETTINGS.resumes);
  assert.equal(be.resume?.id, "backend");
  const fe = pickResume(base({ title: "Senior Frontend Engineer", skills: ["React", "Next.js", "Tailwind"] }), "frontend", DEFAULT_SETTINGS.resumes);
  assert.equal(fe.resume?.id, "frontend");
  assert.equal(renderTemplate("Hi {{company}} / {{missing}}", { company: "Acme" }), "Hi Acme / ");
});
