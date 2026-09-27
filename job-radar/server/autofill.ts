// Auto-fill an application form in a visible browser (career-ops' Playwright), then stop.
// Fills contact fields + uploads the resume, highlights what it did and what still needs you.
// It never clicks anything: reviewing and pressing Submit is always yours (career-ops' ethical-use rule).
//
// Sign-ins (ADR-001, option C): the window uses a persistent Chrome profile in data/browser-profile/.
// You sign in to each site yourself, once — Google, 2FA, a password-manager extension all work — and the
// session cookies are reused. Job Radar never sees or stores a password, and never fills a login form.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import YAML from "yaml";
import type { Profile } from "../shared/types";
import { CAREER_OPS_ROOT, p } from "./careerops";
import { DATA_DIR } from "./store";

export type FieldKey = "first" | "last" | "name" | "email" | "phone" | "linkedin" | "github" | "portfolio" | "location";

/** Which profile value a form field wants, from its label / name / placeholder. Order matters. */
export function matchField(desc: string, type = "text"): FieldKey | null {
  const d = desc.toLowerCase();
  if (/first\s*name|given\s*name|\bfname\b|first_name/.test(d)) return "first";
  if (/last\s*name|surname|family\s*name|\blname\b|last_name/.test(d)) return "last";
  if (type === "email" || /e-?mail/.test(d)) return "email";
  if (type === "tel" || /phone|mobile|\btel\b/.test(d)) return "phone";
  if (/linkedin/.test(d)) return "linkedin";
  if (/github/.test(d)) return "github";
  if (/portfolio|website|personal\s*(site|url|page)|\bblog\b/.test(d)) return "portfolio";
  if (/^(full\s*|legal\s*|your\s*)?name\b|full\s*name|legal\s*name/.test(d.trim())) return "name";
  if (/\blocation\b|current\s*city|\bcity\b|where are you (based|located)/.test(d)) return "location";
  return null;
}

/** Lever and Ashby put the form on a sub-page of the posting. */
export function applyUrl(url: string): string {
  const u = new URL(url);
  if (/(^|\.)lever\.co$/.test(u.hostname) && !/\/apply\/?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/$/, "") + "/apply";
  else if (/(^|\.)ashbyhq\.com$/.test(u.hostname) && u.pathname.split("/").filter(Boolean).length === 2) u.pathname = u.pathname.replace(/\/$/, "") + "/application";
  return u.toString();
}

function values(profile: Profile): Record<FieldKey, string> {
  let github = "";
  try {
    const yml = p("config", "profile.yml");
    if (existsSync(yml)) github = String(YAML.parse(readFileSync(yml, "utf-8"))?.candidate?.github || "");
  } catch {
    /* optional */
  }
  const [first, ...rest] = profile.name.trim().split(/\s+/);
  const url = (s: string) => (s && !/^https?:/.test(s) ? `https://${s}` : s);
  return { first: first || "", last: rest.join(" "), name: profile.name, email: profile.email, phone: profile.phone, linkedin: url(profile.linkedin), github: url(github), portfolio: url(profile.portfolio), location: profile.location };
}

interface FoundField {
  idx: string;
  desc: string;
  type: string;
  tag: string;
  /** Typeahead/select widgets (country pickers, location search) or fields known only by their group heading: left to you. */
  combo: boolean;
  required: boolean;
  empty: boolean;
}

let context: any = null;

export const PROFILE_DIR = () => process.env.JOB_RADAR_BROWSER_PROFILE || resolve(DATA_DIR, "browser-profile");

/** The one signed-in browser window (persistent profile). Real Chrome when installed, else Playwright's Chromium. */
async function browserContext() {
  if (context) return context;
  let pw: any;
  try {
    pw = createRequire(p("package.json"))("playwright");
  } catch {
    throw new Error(`Playwright isn't installed in ${CAREER_OPS_ROOT} (run npm install there)`);
  }
  mkdirSync(PROFILE_DIR(), { recursive: true });
  const opts = {
    headless: process.env.JOB_RADAR_HEADLESS === "1",
    viewport: null,
    // Playwright disables extensions by default; keep them so a password-manager extension (Bitwarden) works.
    ignoreDefaultArgs: ["--disable-extensions"],
  };
  try {
    context = await pw.chromium.launchPersistentContext(PROFILE_DIR(), { ...opts, channel: "chrome" });
  } catch (e) {
    if (/already in use|ProcessSingleton|SingletonLock/i.test((e as Error).message)) throw new Error("The Job Radar browser profile is open in another window — close it and retry.");
    context = await pw.chromium.launchPersistentContext(PROFILE_DIR(), opts);
  }
  context.on("close", () => (context = null));
  return context;
}

/** Opens a page in the signed-in window (used by "Sign in to sites"). */
export async function openInBrowser(url: string) {
  const ctx = await browserContext();
  const blank = ctx.pages().find((pg: any) => pg.url() === "about:blank");
  const page = blank ?? (await ctx.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  await page.bringToFront();
  return { ok: true, profile: PROFILE_DIR() };
}

// Browser-side code is kept as plain JS strings: tsx compiles with keepNames, and the `__name`
// helper it injects into functions doesn't exist in the page, so real functions can't be evaluated.
const SCAN_FIELDS = `function (start) {
  var text = function (el) { return ((el && el.textContent) || "").replace(/\\s+/g, " ").trim(); };
  var skip = ["hidden", "submit", "button", "checkbox", "radio", "search", "password"];
  var i = start;
  return Array.from(document.querySelectorAll("input, textarea, select"))
    .filter(function (el) { return skip.indexOf(el.type) < 0 && (el.type === "file" || el.offsetParent !== null); })
    .map(function (el) {
      var idx = String(i++);
      el.setAttribute("data-jr-idx", idx);
      var fs = el.closest("fieldset");
      var own = Array.from(el.labels || []).map(text).join(" ") || text(el.closest("label"));
      var label = own || text(fs && fs.querySelector("legend"));
      var desc = [label, el.getAttribute("aria-label"), el.placeholder, el.name, el.id].filter(Boolean).join(" | ");
      var weak = !(own || el.getAttribute("aria-label") || el.placeholder || el.name || el.id);
      return { idx: idx, desc: desc, type: el.type, tag: el.tagName.toLowerCase(), combo: weak || el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete"), required: el.required || el.getAttribute("aria-required") === "true" || /\\*\\s*$/.test(label), empty: !el.value };
    });
}`;

const BANNER = `function (filled, left) {
  var b = document.createElement("div");
  b.textContent = "Job Radar filled " + filled + " field(s) (green). " + (left ? left + " required field(s) still need you (orange). " : "") + "Review everything, then submit yourself - nothing was submitted.";
  b.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:10px 16px;background:#111827;color:#fff;font:14px system-ui;box-shadow:0 2px 8px #0005;cursor:pointer";
  b.title = "Click to dismiss";
  b.onclick = function () { b.remove(); };
  document.body.appendChild(b);
}`;

const BANNER_LOGIN = `function () {
  var b = document.createElement("div");
  b.textContent = "Sign in here yourself (Google, password manager, 2FA all work). This window remembers it - then click Auto-fill again in Job Radar.";
  b.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:10px 16px;background:#92400e;color:#fff;font:14px system-ui;box-shadow:0 2px 8px #0005;cursor:pointer";
  b.onclick = function () { b.remove(); };
  document.body.appendChild(b);
}`;

export interface AutofillResult {
  url: string;
  /** The page asked you to sign in; nothing was filled. */
  loginRequired?: boolean;
  filled: Array<{ label: string; value: string }>;
  resumeUploaded: boolean;
  needsYou: string[];
}

export async function autofill(url: string, profile: Profile, resumePath: string | null): Promise<AutofillResult> {
  const ctx = await browserContext();
  const blank = ctx.pages().find((pg: any) => pg.url() === "about:blank");
  const page = blank ?? (await ctx.newPage());
  const target = applyUrl(url);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.bringToFront();

  const out: AutofillResult = { url: target, filled: [], resumeUploaded: false, needsYou: [] };

  // A visible password field means a sign-in (or create-account) wall: that's yours to do, never ours.
  for (const frame of page.frames()) {
    if (await frame.evaluate(`Array.from(document.querySelectorAll('input[type=password]')).some(function (e) { return e.offsetParent !== null; })`).catch(() => false)) {
      out.loginRequired = true;
      await page.evaluate(`(${BANNER_LOGIN})()`).catch(() => {});
      return out;
    }
  }

  const vals = values(profile);
  let n = 0;

  // Greenhouse and others embed the form in an iframe on the company's site, so walk every frame.
  for (const frame of page.frames()) {
    const fields: FoundField[] = await frame
      .evaluate(`(${SCAN_FIELDS})(${n})`)
      .catch((e: Error) => (console.error("[autofill]", e.message), [] as FoundField[]));
    n += fields.length;

    for (const f of fields) {
      const el = frame.locator(`[data-jr-idx="${f.idx}"]`);
      const label = f.desc.split(" | ")[0] || f.desc;
      try {
        if (f.type === "file") {
          if (resumePath && !out.resumeUploaded && !/cover/i.test(f.desc)) {
            await el.setInputFiles(resumePath);
            out.resumeUploaded = true;
            out.filled.push({ label: label || "Resume", value: resumePath.split("/").pop()! });
          } else if (f.required) out.needsYou.push(label || "File upload");
          continue;
        }
        const key = f.tag === "select" || f.combo ? null : matchField(f.desc, f.type);
        if (key && f.empty && vals[key]) {
          await el.fill(vals[key]);
          await el.evaluate("e => { e.style.outline = '2px solid #22c55e' }");
          out.filled.push({ label, value: vals[key] });
        } else if (f.required && f.empty) {
          await el.evaluate("e => { e.style.outline = '2px solid #f59e0b' }");
          out.needsYou.push(label || f.desc);
        }
      } catch {
        if (f.required) out.needsYou.push(label);
      }
    }
  }

  out.needsYou = [...new Set(out.needsYou.filter(Boolean))];
  await page
    .evaluate(`(${BANNER})(${out.filled.length}, ${out.needsYou.length})`)
    .catch(() => {});
  return out;
}

export const browserForTests = () => context;
