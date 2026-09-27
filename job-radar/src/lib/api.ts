import type { Job, ResumeDef, RunEvent, RunInfo, ScrapeStatus, Settings, TrackerRow, Tracking } from "@shared/types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  jobs: () => req<{ jobs: Job[]; tracking: Record<string, Tracking> }>("/api/jobs"),
  job: (id: string) => req<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  track: (jobId: string, patch: Partial<Tracking> & { note?: string }) =>
    req<Tracking & { sync?: { row?: number; created?: boolean; error?: string } }>(`/api/tracking/${encodeURIComponent(jobId)}`, { method: "PUT", body: JSON.stringify(patch) }),
  settings: () => req<Settings>("/api/settings"),
  saveSettings: (s: Settings) => req<Settings & { profileUpdated?: string[] }>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  scrape: (mode: "quick" | "full", sourceId?: string) => req<{ started: boolean }>("/api/scrape", { method: "POST", body: JSON.stringify({ mode, sourceId }) }),
  scrapeStatus: () => req<ScrapeStatus>("/api/scrape/status"),
  detectSource: (url: string) => req<{ kind: "jsgurujobs" | "provider" | "generic"; provider?: string }>(`/api/scrape/detect?url=${encodeURIComponent(url)}`),
  cancelScrape: () => req<{ ok: boolean }>("/api/scrape/cancel", { method: "POST" }),
  resumes: () =>
    req<{
      dir: string;
      files: Array<{ file: string; size: number; mtime: number }>;
      resumes: Array<ResumeDef & { exists: boolean }>;
      tailored: Array<{ file: string; name: string; mtime: number; report?: string }>;
    }>("/api/resumes"),
  resumeUrl: (id: string) => `/api/resumes/${encodeURIComponent(id)}/file`,
  uploadResume: (file: File) =>
    req<{ file: string; dir: string }>(`/api/resumes/upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/pdf" },
    }),
  careerops: () =>
    req<{ available: boolean; root: string; claude: string | null; profile: (Settings["profile"] & { homeCountry: string }) | null }>("/api/careerops"),
  addToPipeline: (url: string) => req<{ added: boolean }>("/api/co/pipeline", { method: "POST", body: JSON.stringify({ url }) }),
  tracker: () => req<{ rows: TrackerRow[]; states: string[]; reports: Array<{ file: string; num: string; mtime: number }> }>("/api/co/tracker"),
  setTrackerStatus: (row: number, state: string, note?: string) => req<unknown>(`/api/co/tracker/${row}/status`, { method: "POST", body: JSON.stringify({ state, note }) }),
  coFile: (path: string) => req<{ path: string; content: string }>(`/api/co/file?path=${encodeURIComponent(path)}`),
  coFileUrl: (path: string) => `/api/co/file?path=${encodeURIComponent(path)}`,
  insights: () => req<Array<{ id: string; title: string; description: string }>>("/api/co/insights"),
  insight: (name: string) => req<{ name: string; title: string; description: string; json: unknown; summary: string | null }>(`/api/co/insights/${name}`),
  skillGap: (jobId: string) =>
    req<{ existing?: unknown[]; supportedByResume?: unknown[]; gap?: unknown[]; lowConfidence?: { reason: string; message: string } }>(`/api/co/skill-gap/${encodeURIComponent(jobId)}`),
  liveness: (jobId: string) => req<{ verdict: "active" | "expired" | "uncertain"; output: string }>(`/api/co/liveness/${encodeURIComponent(jobId)}`),
  runs: () => req<RunInfo[]>("/api/co/runs"),
  run: (id: string) => req<RunInfo & { events: RunEvent[] }>(`/api/co/runs/${id}`),
  startRun: (body: { kind?: "ai" | "scan" | "batch"; mode?: string; jobId?: string; company?: string; extra?: string }) =>
    req<RunInfo>("/api/co/runs", { method: "POST", body: JSON.stringify(body) }),
  cancelRun: (id: string) => req<{ ok: boolean }>(`/api/co/runs/${id}/cancel`, { method: "POST" }),
  importScan: () => req<{ added: number; total: number }>("/api/co/scan/import", { method: "POST" }),
  scanResults: () => req<{ rows: Array<{ url: string; firstSeen: string; portal: string; title: string; company: string; status: string; location: string; postedAt: string }> }>("/api/co/scan/results"),
  autofill: (body: { jobId: string; resumeId?: string; url?: string }) =>
    req<{ url: string; loginRequired?: boolean; filled: Array<{ label: string; value: string }>; resumeUploaded: boolean; needsYou: string[] }>("/api/apply/autofill", { method: "POST", body: JSON.stringify(body) }),
  openBrowser: (url?: string) => req<{ ok: boolean; profile: string }>("/api/browser/open", { method: "POST", body: JSON.stringify({ url }) }),
  resumeByNameUrl: (file: string) => `/api/resumes/by-name/${encodeURIComponent(file)}`,
};
