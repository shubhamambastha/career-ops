import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, ClipboardList, Moon, Radar, Settings2, Sparkles, Sun } from "lucide-react";
import { toast } from "sonner";
import { TRACK_STATUSES, type TrackStatus } from "@shared/types";
import { useAppData, type Row } from "@/hooks/use-app-data";
import { api } from "@/lib/api";
import { ApplyDialog, type ApplyMode } from "@/components/ApplyDialog";
import { JobSheet } from "@/components/JobSheet";
import { ScrapeButton, useScrapeStatus } from "@/components/ScrapePanel";
import { StatusDot } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { JobsPage } from "@/pages/JobsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { CareerOpsPage, type CoTab } from "@/pages/CareerOpsPage";

type Page = "jobs" | "tracker" | "co" | "settings";

/** Hash routes: #/jobs, #/tracker, #/settings, #/co/<tab>?job=…&mode=…&run=… */
function useRoute() {
  const read = () => {
    const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
    const [page, sub] = path.split("/");
    return { page: (["jobs", "tracker", "co", "settings"].includes(page) ? page : "jobs") as Page, sub: (sub || "ai") as CoTab, params: new URLSearchParams(query) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (path: string) => (location.hash = `#/${path}`);
  return { ...route, go };
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("jr.theme");
      return saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("jr.theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const data = useAppData();
  const { rows, settings, updateTracking, reload } = data;
  const route = useRoute();
  const page = route.page;
  const setPage = (p: Page) => route.go(p === "co" ? "co/ai" : p);
  const [dark, setDark] = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const [apply, setApply] = useState<{ id: string; mode: ApplyMode } | null>(null);
  const [careerOps, setCareerOps] = useState(false);
  const scrape = useScrapeStatus(reload);

  useEffect(() => {
    api.careerops().then((c) => setCareerOps(c.available)).catch(() => setCareerOps(false));
  }, []);

  const byId = useMemo(() => new Map(rows.map((r) => [r.job.id, r])), [rows]);
  const openRow = openId ? byId.get(openId) ?? null : null;
  const applyRow = apply ? byId.get(apply.id) ?? null : null;

  const onStatus = useCallback(
    (jobId: string, status: TrackStatus) => {
      updateTracking(jobId, { status });
    },
    [updateTracking],
  );
  const onStar = useCallback((r: Row) => updateTracking(r.job.id, { starred: !r.tracking?.starred }), [updateTracking]);
  const onApply = useCallback((r: Row, mode: ApplyMode) => setApply({ id: r.job.id, mode }), []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TRACK_STATUSES.map((s) => [s, 0])) as Record<TrackStatus, number>;
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);
  const trackedCount = rows.filter((r) => r.status !== "New" || r.tracking?.starred).length;

  const nav: Array<{ id: Page; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: "jobs", label: "Jobs", icon: <Briefcase />, badge: rows.length },
    { id: "tracker", label: "Tracker", icon: <ClipboardList />, badge: trackedCount },
    ...(careerOps ? [{ id: "co" as Page, label: "Career-Ops", icon: <Sparkles /> }] : []),
    { id: "settings", label: "Settings", icon: <Settings2 /> },
  ];

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <header className="bg-background/90 sticky top-0 z-20 border-b backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-4">
            <div className="mr-2 flex items-center gap-2 font-semibold whitespace-nowrap">
              <Radar className="size-5 text-emerald-500" /> <span className="hidden sm:inline">Job Radar</span>
            </div>
            <nav className="flex items-center gap-1">
              {nav.map((n) => (
                <Button key={n.id} variant={page === n.id ? "secondary" : "ghost"} size="sm" onClick={() => setPage(n.id)}>
                  {n.icon}
                  <span className="hidden sm:inline">{n.label}</span>
                  {n.badge != null && <span className="text-muted-foreground text-xs tabular-nums">{n.badge}</span>}
                </Button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <ScrapeButton {...scrape} />
              <Button variant="ghost" size="icon-sm" onClick={() => setDark(!dark)} aria-label="Toggle theme">
                {dark ? <Sun /> : <Moon />}
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] min-w-0 px-4 py-5">
          {data.loading || !settings ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : page === "co" ? (
            <CareerOpsPage tab={route.sub} params={route.params} onTab={(t) => route.go(`co/${t}`)} rows={rows} settings={settings} reload={reload} />
          ) : page === "settings" ? (
            <SettingsPage settings={settings} jobs={data.jobs} tracking={data.tracking} onSave={data.saveSettings} scrape={scrape} />
          ) : (
            <div className="grid min-w-0 gap-4">
              {page === "tracker" && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {TRACK_STATUSES.filter((s) => s !== "New").map((s) => (
                    <Card key={s} className="gap-1 px-4 py-3">
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <StatusDot s={s} /> {s}
                      </div>
                      <div className="text-2xl font-semibold tabular-nums">{counts[s]}</div>
                    </Card>
                  ))}
                </div>
              )}
              <JobsPage
                key={page}
                rows={rows}
                hideBlocked={settings.scoring.hideBlocked}
                hideGone={settings.scoring.hideGone}
                trackerView={page === "tracker"}
                onOpen={(r) => setOpenId(r.job.id)}
                onApply={onApply}
                onStatus={onStatus}
                onStar={onStar}
              />
            </div>
          )}
        </main>

        <JobSheet
          row={openRow}
          onClose={() => setOpenId(null)}
          onTrack={updateTracking}
          onApply={onApply}
          careerOps={careerOps}
          onOpenRun={(id) => {
            setOpenId(null);
            route.go(`co/ai?run=${id}`);
          }}
        />
        {settings && (
          <ApplyDialog
            row={applyRow}
            mode={apply?.mode ?? "link"}
            settings={settings}
            onOpenChange={(o) => !o && setApply(null)}
            onApplied={async (method, resumeId, note) => {
              if (!applyRow) return;
              const t = await updateTracking(applyRow.job.id, { status: "Applied", method, resumeId, note });
              toast.success(`Marked as applied: ${applyRow.job.title}`);
              if (t?.sync?.row) toast.info(`${t.sync.created ? "Added to" : "Updated in"} career-ops tracker (row #${t.sync.row})`);
              if (t?.sync?.error) toast.error(`career-ops tracker not updated: ${t.sync.error}`);
            }}
          />
        )}
        <Toaster position="bottom-right" richColors closeButton theme={dark ? "dark" : "light"} />
      </div>
    </TooltipProvider>
  );
}

