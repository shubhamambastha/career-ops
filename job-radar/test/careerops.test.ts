import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "career-ops-"));
process.env.CAREER_OPS_ROOT = root;
process.env.JOB_RADAR_DATA = mkdtempSync(join(tmpdir(), "job-radar-data-"));
mkdirSync(join(root, "data"), { recursive: true });
mkdirSync(join(root, "config"), { recursive: true });
writeFileSync(
  join(root, "data", "applications.md"),
  `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 3 | 2026-09-25 | HighLevel | Software Development Engineer III - Custom Objects (Backend) | N/A | Applied | ❌ | - | via Job Radar |
| 1 | 2026-08-29 | OrbitShift.ai | Senior Software Development Engineer (SDE III) | 3.2/5 | Evaluated | ❌ | [001](../reports/001-orbitshift-2026-08-29.md) | AI platform role |
`,
);
writeFileSync(join(root, "config", "profile.yml"), "candidate:\n  full_name: Test User\n  linkedin: linkedin.com/in/test\nlocation:\n  city: Raipur\n  country: India\n");
writeFileSync(join(root, "data", "scan-history.tsv"), "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\nhttps://x.io/1\t2026-09-24\tgreenhouse\tBackend Engineer\tAcme\tadded\tRemote\n");

test("reads the career-ops tracker, profile and scan history", async () => {
  const co = await import("../server/careerops");
  const rows = co.readTracker();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].reportNum, "001");
  assert.equal(rows[0].status, "Applied");
  const p = co.readProfile()!;
  assert.equal(p.linkedin, "https://linkedin.com/in/test");
  assert.equal(p.location, "Raipur, India");
  assert.equal(co.readScanHistory()[0].title, "Backend Engineer");
});

test("matches a Job Radar job to its tracker row", async () => {
  const co = await import("../server/careerops");
  const job = { url: "https://jsgurujobs.com/jobs/544", company: "HighLevel", title: "Software Development Engineer III - Custom Objects (Backend)" } as never;
  assert.equal(co.findTrackerRow(job)?.num, 3);
  const other = { url: "https://x", company: "HighLevel", title: "Marketing Manager" } as never;
  assert.equal(co.findTrackerRow(other), undefined);
});

test("builds a headless prompt with the saved JD", async () => {
  const { buildPrompt } = await import("../server/runs");
  const job = { id: "jsgurujobs:1", url: "https://j/1", title: "Dev", company: "Acme", location: "", workFormat: [], skills: ["Node.js"], whoFor: "", descriptionText: "Build APIs", salaryText: "", postedAt: null } as never;
  const prompt = buildPrompt("cover", { job });
  assert.match(prompt, /career-ops "cover" mode/);
  assert.match(prompt, /jds\/job-radar-jsgurujobs_1\.md/);
  assert.match(prompt, /Never submit an application/);
  assert.doesNotMatch(prompt, /CV framing/, "only CV-writing modes get framing");

  const resumes = [
    { id: "be", label: "Backend", file: "be.pdf", focus: ["backend"], keywords: [] },
    { id: "fe", label: "Frontend", file: "fe.pdf", focus: ["frontend"], keywords: [], isDefault: true },
  ] as never;
  const api = { ...(job as object), title: "Senior Backend Engineer" } as never;
  assert.match(buildPrompt("auto-pipeline", { job: api, resumes }), /"Backend" resume[\s\S]*as a backend CV[\s\S]*cv\.md stays the only source/);
  assert.match(buildPrompt("pdf", { job: { ...(job as object), title: "Frontend Developer" } as never, resumes }), /as a frontend CV/);
});

test("refuses to serve files outside career-ops output folders", async () => {
  const co = await import("../server/careerops");
  assert.throws(() => co.safePath("config/profile.yml"));
  assert.throws(() => co.safePath("../../etc/passwd"));
  assert.ok(co.safePath("data/applications.md"));
});

test("resumes live in career-ops documents/cv, legacy PDFs migrate, tailored CVs link to reports", async () => {
  const { DEFAULT_SETTINGS } = await import("../shared/defaults");
  const r = await import("../server/resumes");
  const settings = structuredClone(DEFAULT_SETTINGS);
  assert.equal(r.resumeDir(settings), join(root, "documents", "cv"));

  const legacy = join(process.env.JOB_RADAR_DATA!, "resumes");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "Backend.pdf"), "%PDF-1.4");
  assert.deepEqual(r.migrateLegacyResumes(settings), ["Backend.pdf"]);
  assert.deepEqual(r.listResumeFiles(settings).map((f) => f.file), ["Backend.pdf"]);
  assert.equal(r.resumeFile(settings, "Backend.pdf"), join(root, "documents", "cv", "Backend.pdf"));

  mkdirSync(join(root, "output", "008-acme", "cv", "tailored", "v001"), { recursive: true });
  writeFileSync(join(root, "output", "008-acme", "cv", "tailored", "v001", "cv.pdf"), "%PDF");
  writeFileSync(join(root, "output", "cv-shubham-other-2026-09-25.pdf"), "%PDF");
  writeFileSync(join(root, "output", "acme-cover.pdf"), "%PDF");
  writeFileSync(join(root, "data", "pdf-index.tsv"), "# report\tpdf\thtml\tformat\tdate\n008\toutput/008-acme/cv/tailored/v001/cv.pdf\t-\ta4\t2026-09-25\n");
  const t = r.listTailored();
  assert.equal(t.length, 2, "cover letters are not resumes");
  assert.equal(t.find((x) => x.file.endsWith("v001/cv.pdf"))?.report, "008");

  settings.resumeFolder = "my-cvs";
  assert.equal(r.resumeDir(settings), join(root, "my-cvs"));
});

test("Settings profile writes back to profile.yml, keeping comments and URL style", async () => {
  const co = await import("../server/careerops");
  const { readFileSync } = await import("node:fs");
  const file = join(root, "config", "profile.yml");
  writeFileSync(file, '# my profile\ncandidate:\n  full_name: "Test User" # keep me\n  linkedin: "linkedin.com/in/test"\nlocation:\n  country: India\n');
  const base = { name: "Test User", email: "", phone: "", linkedin: "https://linkedin.com/in/test", portfolio: "", location: "" };
  assert.deepEqual(co.writeProfile(base), [], "https:// vs bare linkedin is not a change");
  assert.deepEqual(co.writeProfile({ ...base, name: "New Name", email: "a@b.io" }), ["candidate.full_name", "candidate.email"]);
  const yml = readFileSync(file, "utf-8");
  assert.match(yml, /# my profile/);
  assert.match(yml, /full_name: "New Name" # keep me/);
  assert.match(yml, /linkedin: "linkedin.com\/in\/test"/);
  assert.equal(co.readProfile()?.email, "a@b.io");
});
