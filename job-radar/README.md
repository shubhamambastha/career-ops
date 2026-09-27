# job-radar

A local job board for career-ops. It scrapes job listings from a link you give it, ranks every job against your profile with a scoring system you can edit, suggests which resume to send, and tracks what you applied to.

Built with React 19 + shadcn/ui (Tailwind v4, Radix) + TanStack Table on the front end and a small Express API. Data is plain JSON on disk.

```
job-radar/
├── server/            Express API, scraper, career-ops bridge
│   └── sources/       one adapter per site (jsgurujobs.ts)
├── shared/            types, default settings, scoring + resume picker (used by API and UI)
├── src/               React UI (pages/, components/ui = shadcn components)
├── seed/              jobs from the first manual scrape, shown until your first real scrape
├── data/              your data (git-ignored): jobs.json, settings.json, tracking.json, runs/
└── test/              parser, robots.txt, scoring and scraper tests
```

## Run it

```bash
cd job-radar
npm install
npm run dev          # UI on http://localhost:5173 (API on :5174)
```

Or build once and serve both on one port:

```bash
npm run build && npm start   # http://localhost:5174
```

**Resumes are shared with career-ops:**

- **Base resumes:** the PDFs you send as they are go in career-ops' `documents/cv/`. That's career-ops' own "master CV" folder: git-ignored, never touched by its updater, and read by its `intake` mode.
- **Choosing files:** in **Settings → Resumes**, pick each resume's file from that folder, or upload one there.
- **Tailored CVs:** the ones career-ops generates in `output/` (from `pdf` mode or "Evaluate + tailor CV") appear in the apply dialog automatically. They're linked to their evaluation report through `data/pdf-index.tsv`, so the one made for a job is preselected when you apply to it.
- **Old files:** any PDFs left in the old `job-radar/data/resumes/` are moved to the shared folder when the server starts.
- **Your CV text:** career-ops' `cv.md` is still the source it uses to write tailored CVs. Keep it in sync with your PDFs; the `intake` mode can propose updates from the PDFs in `documents/cv/`.

## Pages

- **Jobs:** every job ranked by score. You can:
  - filter by tier, eligibility, focus, status, posting date, minimum score, starred, and "has a recruiter email"
  - search, sort any column, show or hide columns, and export to CSV
  - click a row to see the score breakdown, matched and missing skills, the suggested resume, notes, the status history, and the full description
- **Tracker:** only the jobs you starred, shortlisted, applied to, and so on, with counts per status.
- **Settings:**
  - *Ranking & score:* weights, your skills and aliases, location rules, seniority, focus, recency, tiers, and keyword boosts or penalties. A live preview shows how the top 12 would change before you save.
  - *Sources & scraping:* the links to scrape, sweep depth, delay between requests, how often to refresh, and the scrape log.
  - *Resumes:* files, which job focus each one suits, and keywords that favour it.
  - *Email template:* placeholders such as `{{title}}` and `{{company}}`.
  - *Profile:* your contact details. You can import them from career-ops `config/profile.yml`.

## Scraping

Click **Scrape** in the header:

- **Check for new jobs:** reads your source link and any pages it links to, then fetches only jobs it hasn't seen yet.
- **Full scan:** also goes through job IDs below the newest one (as many as *sweep depth*) and re-fetches jobs older than *refresh after days*. Pages that have disappeared are marked "removed".

From a terminal or cron: `npm run scrape` (add `-- --full` for a full scan).

The scraper follows jsgurujobs' robots.txt. That file blocks `/api/` and most paginated listings, so the scraper reads individual job pages (`/jobs/{id}`) one at a time, waiting *delay* ms between requests. The first full scan of about 700 IDs takes around 15 minutes. After that, scans are quick.

**Any other site** (`server/sources/generic.ts`) — paste any listing link in Settings → Sources; the badge next to it shows how it will be read:

- **ATS / board API** (Greenhouse, Lever, Ashby, Workable, Workday, SmartRecruiters, Himalayas… 80+): career-ops' own `providers/` layer (the same one `scan.mjs` uses) lists the jobs, then each job page is fetched for the description.
- **Any site (JSON-LD):** the listing's links (plus `?page=N` up to *Listing pages*) are read, and each job page is parsed from its schema.org `JobPosting` data — title, company, remote/country rules, salary, date, experience. Pages without it are skipped. JS-only listings fall back to career-ops' headless reader (`browser-extract.mjs`).
- *Only titles containing* / *Titles not containing* skip postings before any job page is fetched (exclude wins); *Max jobs per scan* caps job-page requests.

A site that needs a bespoke parser still gets an adapter like `server/sources/jsgurujobs.ts`, dispatched in `server/scrape.ts`.

## How the score works

`score = Σ(component × weight) / Σ(weights) + keyword-rule points`, clamped to 0–100. Jobs you can't apply to are capped at *max score for not-eligible jobs*.

| Component | What it measures |
|---|---|
| Skills | How much of the job's required stack is on your skills list. Skills with a higher weight count more. Skills not on your list count as gaps. |
| Location | Can apply (remote with your region or country) · Relocate (on-site in your country) · Unclear (remote, countries not stated) · Not eligible |
| Seniority | Years asked vs your years: a penalty for each year over, a low score for roles well below your level, plus title rules |
| Focus | Backend / full-stack / frontend / other preference |
| Recency | Half-life decay on the posting date |

Scoring runs in the browser from `shared/scoring.ts`, so changing Settings re-ranks the list instantly.

## Applying (draft-only)

The app never sends or submits anything:

- **Apply via link:** opens the job page (or an ATS link found in the description) in a new tab. On jsgurujobs you have to be logged in before its Apply button works.
- **Auto-fill:** next to each link in *Apply via link*. It opens the form in a visible Chromium window (career-ops' Playwright), fills name, email, phone, LinkedIn, GitHub, portfolio and location from `config/profile.yml`, uploads the resume you picked, outlines what it filled in green and the required fields it left in orange, and **stops**. It never clicks anything, so you answer the rest and press Submit yourself. It doesn't touch fields you've already filled or dropdown/typeahead pickers. Lever and Ashby links are sent to their `/apply` and `/application` pages. **Signing in:** the window uses its own Chrome profile (`data/browser-profile/`). In **Settings → Profile → Sign in to job sites**, open each site and sign in once, yourself (Google sign-in, 2FA and the Bitwarden extension all work); it stays signed in. If Auto-fill lands on a sign-in page, it stops without filling anything and asks you to sign in, then retry. Job Radar never stores or types passwords ([ADR-001](docs/adr/001-browser-sign-in.md)).
- **Apply by email:** fills in your template with the recruiter address found in the posting (you can edit it), then opens a Gmail or mail-app draft. Browsers can't attach files to a draft, so the dialog has a **Download** button for the suggested resume. Attach it yourself before you send.
- After you apply, click **Mark as applied**. The app records the method, the resume you used, and the time.

## Career-Ops page

job-radar lives inside career-ops. The **Career-Ops** page in the top bar uses career-ops' own scripts and modes. To point job-radar at a different folder, set `CAREER_OPS_ROOT`.

| Tab | What it does | Uses |
|---|---|---|
| **AI Studio** | Runs a career-ops mode on a job you pick (or on a company, your profile, or text you paste): evaluate + tailored CV, triage, report only, compare offers, tailored CV, cover letter, application email, LinkedIn outreach, form answers, deep research, red-flag check, find company job boards, interview prep / plan / debrief, understand an offer, follow-ups, classify a reply, record outcome, rejection patterns, process the pipeline inbox, add to CV, profile intake, evaluate a course or project, adjacent job titles, missing competencies, upskill, or a custom prompt. The run log streams live, and the files it creates (reports, PDFs, drafts) open in the app. Runs queue one at a time. | `claude -p` (Claude Code) in the career-ops folder, reading `.claude/skills/career-ops` + `modes/` |
| **Pipeline** | career-ops `data/applications.md` with a status filter and inline status changes. Click a row to read its evaluation report. | `set-status.mjs` |
| **Insights** | Stats, follow-ups due, funnel & velocity, rejection patterns, skill gaps across your pipeline, salary gap, reposts, post-interview silence, recruiting friction, tracker drift, weekly interview digest, contacts, pipeline health. | `stats`, `followup-cadence`, `funnel-velocity`, `analyze-patterns`, `upskill`, `salary-gap`, `detect-reposts`, `rejection-latency`, `process-quality`, `tracker-sync-check`, `weekly-digest`, `contacts`, `verify-pipeline` (no AI) |
| **Scanner** | Runs the career-ops portal scanner over `portals.yml` and imports its results into the Jobs table, ranked with everything else. | `scan.mjs` (no AI) |

Each job's side panel also has:

- quick AI actions, which start the run and take you to AI Studio
- **Skill gap vs cv.md**, using `jd-skill-gap.mjs`
- **Is it still live?**, using `check-liveness.mjs`
- **Add to pipeline**, which appends the job to `data/pipeline.md`

**Tracker sync (Settings → career-ops):** when you mark a job Applied, Responded, Interview, Offer, Rejected or Discarded, it's mirrored into career-ops' tracker:

- If the job already has a row, `set-status.mjs` updates it.
- Otherwise a row is added through a tracker-additions TSV and `merge-tracker.mjs`, with score `N/A` and no report.

**AI runner:**
- You need Claude Code installed and logged in (`npm i -g @anthropic-ai/claude-code`, then run `claude` once).
- By default Claude only gets an allowlist of tools, and edits are auto-accepted.
- You can switch to bypass mode, which is what career-ops batch mode uses.
- Every prompt tells Claude to work headless and draft only. The job description is saved to `jds/` first, so Claude doesn't need to log in to the job site.

## Tests

```bash
npm test        # parser, robots.txt, eligibility, scoring, resume picker, scraper (mocked network), career-ops bridge
npm run typecheck
```
