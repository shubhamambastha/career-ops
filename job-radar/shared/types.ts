// Shared data model for the API (server/) and the UI (src/).

export interface Job {
  /** Stable key: `${source}:${sourceId}` */
  id: string;
  source: string;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  /** Badges such as "Remote", "Hybrid", "Onsite", "Worldwide", "APAC" */
  workFormat: string[];
  jobType: string;
  salaryText: string;
  /** ISO date (YYYY-MM-DD) or null when unknown */
  postedAt: string | null;
  skills: string[];
  descriptionText: string;
  descriptionHtml: string;
  /** "Who is this job for?" blurb when the source provides one */
  whoFor: string;
  summary: string;
  /** Minimum years of experience found in the posting (null = not stated) */
  minYears: number | null;
  /** Email addresses found in the posting (for email applications) */
  emails: string[];
  /** External apply links found in the posting (ATS pages etc.) */
  applyLinks: string[];
  status: "open" | "gone";
  firstSeenAt: string;
  lastSeenAt: string;
  lastFetchedAt: string;
}

export const TRACK_STATUSES = [
  "New",
  "Shortlisted",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export interface TrackEvent {
  at: string;
  status: TrackStatus;
  note?: string;
}

export interface Tracking {
  jobId: string;
  status: TrackStatus;
  appliedAt?: string;
  method?: "link" | "email" | "other";
  resumeId?: string;
  notes?: string;
  starred?: boolean;
  /** Row number in career-ops data/applications.md once synced */
  careerOpsRow?: number;
  updatedAt: string;
  history: TrackEvent[];
}

export interface SkillDef {
  name: string;
  aliases: string[];
  /** 1 = normal; >1 = core skill you want to be matched on */
  weight: number;
}

export interface KeywordRule {
  /** Case-insensitive regular expression tested on title + skills + description */
  pattern: string;
  points: number;
  label?: string;
}

export interface ScoringSettings {
  weights: {
    skills: number;
    location: number;
    seniority: number;
    focus: number;
    recency: number;
  };
  skills: SkillDef[];
  location: {
    homeCountry: string;
    /** Cities/states that also mean "in your country" (e.g. Bengaluru, Pune) */
    homeAliases: string[];
    /** Not-eligible jobs can never score above this */
    blockedMaxScore: number;
    /** Words that, next to "remote", mean you can apply from your country */
    acceptedRegions: string[];
    /** Phrases that mean you cannot apply (checked when your country is not mentioned) */
    blockPhrases: string[];
    points: { remoteEligible: number; homeOnsite: number; unclear: number; blocked: number };
  };
  seniority: {
    myYears: number;
    /** Score when the posting states no minimum */
    unknownPoints: number;
    /** Points lost per year the posting asks above your experience */
    penaltyPerYearOver: number;
    /** A role asking this many fewer years than you have is treated as too junior */
    tooJuniorGap: number;
    tooJuniorPoints: number;
    titleRules: KeywordRule[];
  };
  focus: {
    backend: number;
    fullstack: number;
    frontend: number;
    other: number;
  };
  recency: { halfLifeDays: number };
  keywordRules: KeywordRule[];
  tiers: { A: number; B: number; C: number };
  hideBlocked: boolean;
  hideGone: boolean;
}

export interface SourceConfig {
  id: string;
  /** The link you want scraped, e.g. https://jsgurujobs.com/jobs */
  url: string;
  enabled: boolean;
  /** jsgurujobs: job IDs below the newest one to sweep on a full scan. Other sites: max job pages fetched per scan. */
  sweepDepth: number;
  /** Other sites: listing pages to follow (?page=N). Default 3. */
  maxPages?: number;
  /** Only fetch postings whose title contains one of these (case-insensitive). Empty = all. */
  titleKeywords?: string[];
  /** Skip postings whose title contains any of these (case-insensitive), e.g. "intern", "sales". */
  titleExclude?: string[];
  delayMs: number;
  refreshAfterDays: number;
}

export interface ResumeDef {
  id: string;
  label: string;
  /** File name inside data/resumes/ (or an absolute path) */
  file: string;
  focus: Array<"backend" | "fullstack" | "frontend" | "other">;
  keywords: string[];
  isDefault?: boolean;
}

export interface Profile {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  portfolio: string;
  location: string;
}

export interface CareerOpsSettings {
  /** Mirror Applied/Responded/Interview/Offer/Rejected/Discarded into career-ops' tracker */
  syncTracker: boolean;
  /** Headless AI CLI command (Claude Code) */
  claudeCommand: string;
  /** Optional model passed as --model */
  model: string;
  /** allowlist = only the tools below; bypass = --dangerously-skip-permissions (what batch mode uses) */
  permission: "allowlist" | "bypass";
  allowedTools: string;
  scanSinceDays: number;
  scanVerify: boolean;
}

export interface Settings {
  profile: Profile;
  /** Where base resume PDFs live. Empty = career-ops documents/cv/ (shared with career-ops). Relative paths are from the career-ops root. */
  resumeFolder: string;
  careerOps: CareerOpsSettings;
  sources: SourceConfig[];
  scoring: ScoringSettings;
  resumes: ResumeDef[];
  email: {
    client: "gmail" | "mailto";
    subject: string;
    body: string;
  };
}

export type Eligibility = "remote_ok" | "home_onsite" | "unclear" | "blocked";
export type Focus = "backend" | "fullstack" | "frontend" | "other";

export interface ScoreBreakdown {
  total: number;
  tier: "A" | "B" | "C" | "D";
  parts: { skills: number; location: number; seniority: number; focus: number; recency: number };
  adjustments: Array<{ label: string; points: number }>;
  eligibility: Eligibility;
  eligibilityReason: string;
  focus: Focus;
  matchedSkills: string[];
  missingSkills: string[];
  daysOld: number | null;
}

export interface ScrapeStatus {
  running: boolean;
  sourceId?: string;
  phase?: string;
  done: number;
  total: number;
  added: number;
  updated: number;
  gone: number;
  errors: number;
  startedAt?: string;
  finishedAt?: string;
  log: string[];
}

// ---- career-ops bridge -------------------------------------------------------

export interface TrackerRow {
  num: number;
  date: string;
  company: string;
  role: string;
  score: string;
  status: string;
  pdf: string;
  report: string;
  reportNum: string | null;
  notes: string;
  url?: string;
}

export type RunKind = "ai" | "scan" | "batch";
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface RunEvent {
  t: string;
  kind: "text" | "tool" | "result" | "log" | "error";
  text: string;
}

export interface RunInfo {
  id: string;
  kind: RunKind;
  mode: string;
  title: string;
  jobId?: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  /** Final answer from the AI (stream-json "result") */
  result?: string;
  costUsd?: number;
  outputs: string[];
  prompt?: string;
}

export interface AiMode {
  id: string;
  label: string;
  group: "Evaluate" | "Apply" | "Research" | "Interview" | "Offer" | "Track" | "Profile";
  description: string;
  needs: Array<"job" | "company" | "none">;
  /** When set, the mode needs text from you (a pasted email, contract, notes…): the field's label. */
  input?: string;
  inputHint?: string;
}
