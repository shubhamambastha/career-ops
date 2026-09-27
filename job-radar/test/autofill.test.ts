import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

process.env.CAREER_OPS_ROOT = resolve(import.meta.dirname, "../.."); // playwright lives in career-ops
process.env.JOB_RADAR_HEADLESS = "1";
process.env.JOB_RADAR_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), "jr-profile-"));
after(async () => (await import("../server/autofill")).browserForTests()?.close());
const fixture = (f: string) => pathToFileURL(resolve(import.meta.dirname, "fixtures", f)).href;

test("matches form fields to profile values", async () => {
  const { matchField, applyUrl } = await import("../server/autofill");
  assert.equal(matchField("First Name * | first_name"), "first");
  assert.equal(matchField("Full name"), "name");
  assert.equal(matchField("", "email"), "email");
  assert.equal(matchField("LinkedIn Profile | urls[LinkedIn]"), "linkedin");
  assert.equal(matchField("Website"), "portfolio");
  assert.equal(matchField("Why do you want to work here?"), null);
  assert.equal(applyUrl("https://jobs.lever.co/acme/abc-123"), "https://jobs.lever.co/acme/abc-123/apply");
  assert.equal(applyUrl("https://jobs.ashbyhq.com/acme/abc"), "https://jobs.ashbyhq.com/acme/abc/application");
});

test("fills a form, uploads the resume, flags the rest, never submits", { timeout: 60_000 }, async () => {
  const { autofill } = await import("../server/autofill");
  const pdf = join(mkdtempSync(join(tmpdir(), "jr-")), "cv.pdf");
  writeFileSync(pdf, "%PDF-1.4\n");
  const url = fixture("apply-form.html");
  const profile = { name: "Test User Name", email: "t@u.io", phone: "+91-1", linkedin: "linkedin.com/in/t", portfolio: "https://t.dev", location: "Raipur" };
  const { browserForTests } = await import("../server/autofill");
  const r = await autofill(url, profile, pdf).catch(async (e) => {
    await browserForTests()?.close();
    throw e;
  });
  const got = Object.fromEntries(r.filled.map((f) => [f.label, f.value]));
  assert.equal(got["First Name *"], "Test");
  assert.equal(got["Last Name *"], "User Name");
  assert.equal(got["LinkedIn Profile"], "https://linkedin.com/in/t");
  assert.ok(r.resumeUploaded);
  assert.ok(!r.filled.some((f) => /Location/.test(f.label)), "never overwrites a filled field");
  assert.deepEqual(r.needsYou, ["Why do you want to work here? *"]);
  const page = browserForTests().pages().find((pg: any) => pg.url() === url);
  assert.equal(await page.evaluate("window.__submitted"), undefined, "never submits");
});

test("stops at a sign-in page without filling it", { timeout: 60_000 }, async () => {
  const { autofill, browserForTests } = await import("../server/autofill");
  const profile = { name: "A B", email: "a@b.io", phone: "", linkedin: "", portfolio: "", location: "" };
  const r = await autofill(fixture("login.html"), profile, null);
  assert.equal(r.loginRequired, true);
  assert.deepEqual(r.filled, []);
  const page = browserForTests().pages().find((pg: any) => pg.url().endsWith("login.html"));
  assert.equal(await page.inputValue("input[type=email]"), "", "login forms are never filled");
});
