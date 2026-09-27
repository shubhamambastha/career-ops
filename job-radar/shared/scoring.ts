import type {
  Eligibility,
  Focus,
  Job,
  KeywordRule,
  ResumeDef,
  ScoreBreakdown,
  Settings,
  SkillDef,
} from "./types";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** Whole-word-ish match that also works for tokens like "c#", "node.js", "ci/cd". */
function hasTerm(haystack: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(t)}($|[^a-z0-9])`, "i").test(haystack);
}

function skillTerms(def: SkillDef): string[] {
  return [def.name, ...def.aliases].map(norm).filter(Boolean);
}

/** Maps a job skill chip (e.g. "ReactJS") to one of your skills, if any. */
export function matchSkill(chip: string, mine: SkillDef[]): SkillDef | undefined {
  const c = norm(chip);
  return mine.find((d) => skillTerms(d).some((t) => t === c || hasTerm(c, t) && t.length > 3));
}

export function jobSkills(job: Job, mine: SkillDef[]): string[] {
  if (job.skills.length) return job.skills;
  // Fallback: detect known skills in the description (long-enough terms only, to avoid noise).
  const text = norm(`${job.title} ${job.descriptionText}`);
  return mine.filter((d) => skillTerms(d).some((t) => t.length > 3 && hasTerm(text, t))).map((d) => d.name);
}

export function detectFocus(job: Job): Focus {
  const t = norm(job.title);
  const all = norm(`${job.title} ${job.skills.join(" ")} ${job.whoFor}`);
  if (/full[- ]?stack|product engineer/.test(t)) return "fullstack";
  if (/back[- ]?end|backend|api|platform|server|node|sdk|infrastructure/.test(t)) return "backend";
  if (/front[- ]?end|frontend|ui\b|ux|react|web engineer|vue|angular/.test(t)) return "frontend";
  const be = /(node\.?js|nestjs|express|postgres|mongodb|redis|kafka|microservice|backend)/.test(all);
  const fe = /(react|vue|angular|css|frontend|next\.js|svelte)/.test(all);
  if (be && fe) return "fullstack";
  if (be) return "backend";
  if (fe) return "frontend";
  return "other";
}

export function classifyLocation(job: Job, s: Settings["scoring"]["location"]): { eligibility: Eligibility; reason: string } {
  const home = norm(s.homeCountry);
  const where = norm(`${job.location} ${job.workFormat.join(" ")}`);
  const desc = norm(`${job.whoFor} ${job.summary} ${job.descriptionText.slice(0, 4000)}`);
  const remote = /remote|anywhere|worldwide|distributed/.test(where);
  const onsite = /onsite|on-site|office|hybrid/.test(where) && !/remote/.test(where);
  const homeTerms = [home, ...(s.homeAliases || []).map(norm)].filter(Boolean);
  const homeInWhere = homeTerms.some((t) => hasTerm(where, t));
  const homeInDesc = homeTerms.some((t) => hasTerm(desc, t));
  const blockHit = s.blockPhrases.find((p) => p && (where.includes(norm(p)) || desc.includes(norm(p))));
  const regionHit = s.acceptedRegions.find((r) => r && hasTerm(where, r));

  if (homeInWhere) {
    if (remote) return { eligibility: "remote_ok", reason: `Remote, ${s.homeCountry} listed` };
    if (onsite || !remote) return { eligibility: "home_onsite", reason: `${s.homeCountry} on-site/hybrid — may need relocation` };
  }
  if (blockHit && !homeInDesc) return { eligibility: "blocked", reason: `Restricted: "${blockHit}"` };
  if (remote && regionHit) return { eligibility: "remote_ok", reason: `Remote (${regionHit})` };
  if (remote) return { eligibility: "unclear", reason: "Remote, but allowed countries not stated" };
  if (homeInDesc) return { eligibility: "unclear", reason: `${s.homeCountry} mentioned in description` };
  return { eligibility: "blocked", reason: `On-site outside ${s.homeCountry || "your country"}` };
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - d.getTime()) / 86_400_000));
}

function applyRules(rules: KeywordRule[], text: string) {
  const out: Array<{ label: string; points: number }> = [];
  for (const r of rules) {
    const re = safeRegex(r.pattern);
    if (re && re.test(text)) out.push({ label: r.label || r.pattern, points: r.points });
  }
  return out;
}

export function scoreJob(job: Job, settings: Settings, now = new Date()): ScoreBreakdown {
  const sc = settings.scoring;

  // Skills: weighted share of the job's stack that you have.
  const chips = jobSkills(job, sc.skills);
  const matched: string[] = [];
  const missing: string[] = [];
  let have = 0;
  let total = 0;
  for (const chip of chips) {
    const m = matchSkill(chip, sc.skills);
    if (m) {
      matched.push(chip);
      have += m.weight;
      total += m.weight;
    } else {
      missing.push(chip);
      total += 1;
    }
  }
  const skills = total ? (have / total) * 100 : 50;

  // Location / eligibility.
  const { eligibility, reason } = classifyLocation(job, sc.location);
  const lp = sc.location.points;
  const location =
    eligibility === "remote_ok" ? lp.remoteEligible : eligibility === "home_onsite" ? lp.homeOnsite : eligibility === "unclear" ? lp.unclear : lp.blocked;

  // Seniority.
  const sen = sc.seniority;
  let seniority: number;
  if (job.minYears == null) seniority = sen.unknownPoints;
  else if (job.minYears > sen.myYears) seniority = 100 - (job.minYears - sen.myYears) * sen.penaltyPerYearOver;
  else if (sen.myYears - job.minYears >= sen.tooJuniorGap) seniority = sen.tooJuniorPoints;
  else seniority = 100;
  const titleAdj = applyRules(sen.titleRules, job.title);
  seniority = clamp(seniority + titleAdj.reduce((a, b) => a + b.points, 0));

  // Focus.
  const focusKind = detectFocus(job);
  const focus = sc.focus[focusKind];

  // Recency (exponential decay).
  const daysOld = daysSince(job.postedAt, now);
  const recency = daysOld == null ? 50 : 100 * Math.pow(0.5, daysOld / Math.max(1, sc.recency.halfLifeDays));

  const parts = { skills, location, seniority, focus, recency };
  const w = sc.weights;
  const wsum = w.skills + w.location + w.seniority + w.focus + w.recency || 1;
  const base =
    (parts.skills * w.skills + parts.location * w.location + parts.seniority * w.seniority + parts.focus * w.focus + parts.recency * w.recency) / wsum;

  const text = `${job.title}\n${job.skills.join(", ")}\n${job.descriptionText}`;
  const adjustments = applyRules(sc.keywordRules, text);
  let raw = clamp(base + adjustments.reduce((a, b) => a + b.points, 0));
  if (eligibility === "blocked") raw = Math.min(raw, sc.location.blockedMaxScore ?? 100);
  const totalScore = Math.round(raw);

  const t = sc.tiers;
  const tier = totalScore >= t.A ? "A" : totalScore >= t.B ? "B" : totalScore >= t.C ? "C" : "D";

  return {
    total: totalScore,
    tier,
    parts: {
      skills: Math.round(parts.skills),
      location: Math.round(parts.location),
      seniority: Math.round(parts.seniority),
      focus: Math.round(parts.focus),
      recency: Math.round(parts.recency),
    },
    adjustments: [...titleAdj.map((a) => ({ ...a, label: `Seniority: ${a.label}` })), ...adjustments],
    eligibility,
    eligibilityReason: reason,
    focus: focusKind,
    matchedSkills: matched,
    missingSkills: missing,
    daysOld,
  };
}

export interface ResumePick {
  resume: ResumeDef | undefined;
  reason: string;
  ranking: Array<{ id: string; label: string; score: number; hits: string[] }>;
}

/** Suggests which of your resumes to send for a job. */
export function pickResume(job: Job, focus: Focus, resumes: ResumeDef[]): ResumePick {
  const text = norm(`${job.title} ${job.skills.join(" ")} ${job.whoFor} ${job.summary}`);
  const ranking = resumes.map((r) => {
    const hits = r.keywords.filter((k) => hasTerm(text, k));
    const score = hits.length + (r.focus.includes(focus) ? 3 : 0) + (r.isDefault ? 0.5 : 0);
    return { id: r.id, label: r.label, score, hits };
  });
  ranking.sort((a, b) => b.score - a.score);
  const best = ranking[0];
  const resume = resumes.find((r) => r.id === best?.id);
  const reason = best
    ? `${focus} role${best.hits.length ? ` — matches ${best.hits.slice(0, 5).join(", ")}` : ""}`
    : "No resumes configured";
  return { resume, reason, ranking };
}

/** Fills {{placeholders}} in the email template. */
export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}
