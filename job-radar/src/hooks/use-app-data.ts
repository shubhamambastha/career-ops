import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { pickResume, scoreJob, type ResumePick } from "@shared/scoring";
import type { Job, ScoreBreakdown, Settings, Tracking, TrackStatus } from "@shared/types";
import { api } from "@/lib/api";

export interface Row {
  job: Job;
  score: ScoreBreakdown;
  tracking: Tracking | undefined;
  status: TrackStatus;
  resume: ResumePick;
  rank: number;
}

/** Scores every job with the current settings; re-ranks instantly when settings change. */
export function rankJobs(jobs: Job[], tracking: Record<string, Tracking>, settings: Settings): Row[] {
  const now = new Date();
  const rows = jobs.map((job) => {
    const score = scoreJob(job, settings, now);
    return {
      job,
      score,
      tracking: tracking[job.id],
      status: tracking[job.id]?.status ?? ("New" as TrackStatus),
      resume: pickResume(job, score.focus, settings.resumes),
      rank: 0,
    };
  });
  rows.sort((a, b) => b.score.total - a.score.total || (b.job.postedAt || "").localeCompare(a.job.postedAt || ""));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function useAppData() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tracking, setTracking] = useState<Record<string, Tracking>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [data, s] = await Promise.all([api.jobs(), api.settings()]);
      setJobs(data.jobs);
      setTracking(data.tracking);
      setSettings(s);
    } catch (e) {
      toast.error(`Could not reach the job-radar API: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const updateTracking = useCallback(async (jobId: string, patch: Partial<Tracking> & { note?: string }) => {
    try {
      const t = await api.track(jobId, patch);
      setTracking((prev) => ({ ...prev, [jobId]: t }));
      if (t.sync?.error) toast.error(`career-ops tracker not updated: ${t.sync.error}`);
      return t;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  const saveSettings = useCallback(async (s: Settings) => {
    const { profileUpdated, ...saved } = await api.saveSettings(s);
    setSettings(saved);
    return { ...saved, profileUpdated };
  }, []);

  const visibleJobs = useMemo(() => jobs, [jobs]);
  const rows = useMemo(() => (settings ? rankJobs(visibleJobs, tracking, settings) : []), [visibleJobs, tracking, settings]);

  return { rows, jobs, tracking, settings, setSettings, saveSettings, updateTracking, reload, loading };
}

export type AppData = ReturnType<typeof useAppData>;
