import { useEffect, useState } from "react";
import { BarChart3, ClipboardList, Radar, Sparkles } from "lucide-react";
import type { Settings } from "@shared/types";
import type { Row } from "@/hooks/use-app-data";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiStudio } from "@/pages/careerops/AiStudio";
import { InsightsPage } from "@/pages/careerops/InsightsPage";
import { PipelinePage } from "@/pages/careerops/PipelinePage";
import { ScannerPage } from "@/pages/careerops/ScannerPage";

export type CoTab = "ai" | "pipeline" | "insights" | "scanner";

export function CareerOpsPage({ tab, params, onTab, rows, settings, reload }: { tab: CoTab; params: URLSearchParams; onTab: (t: CoTab) => void; rows: Row[]; settings: Settings; reload: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.careerops>> | null>(null);
  useEffect(() => {
    api.careerops().then(setInfo).catch(() => null);
  }, []);

  if (info && !info.available)
    return (
      <p className="text-muted-foreground">
        career-ops wasn't found at <code>{info.root}</code>. Put job-radar inside your career-ops folder or start it with <code>CAREER_OPS_ROOT=/path/to/career-ops</code>.
      </p>
    );

  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as CoTab)}>
      <div className="flex flex-wrap items-center gap-3">
        <TabsList>
          <TabsTrigger value="ai">
            <Sparkles /> AI Studio
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            <ClipboardList /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="insights">
            <BarChart3 /> Insights
          </TabsTrigger>
          <TabsTrigger value="scanner">
            <Radar /> Scanner
          </TabsTrigger>
        </TabsList>
        <span className="text-muted-foreground text-xs">
          career-ops · <code>{info?.root}</code>
          {info && ` · ${info.claude ? `Claude Code ${info.claude}` : "claude CLI not found"}`}
        </span>
      </div>
      <TabsContent value="ai">
        <AiStudio key={params.get("run") || params.get("job") || "ai"} rows={rows} claude={info?.claude} initial={{ job: params.get("job") || undefined, mode: params.get("mode") || undefined, run: params.get("run") || undefined }} />
      </TabsContent>
      <TabsContent value="pipeline">
        <PipelinePage />
      </TabsContent>
      <TabsContent value="insights">
        <InsightsPage />
      </TabsContent>
      <TabsContent value="scanner">
        <ScannerPage settings={settings} onImported={reload} />
      </TabsContent>
    </Tabs>
  );
}
