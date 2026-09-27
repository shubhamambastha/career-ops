import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import type { ScrapeStatus } from "@shared/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";

/** Polls scrape progress; calls onFinished when a run ends so the table reloads. */
export function useScrapeStatus(onFinished: () => void) {
  const [status, setStatus] = useState<ScrapeStatus | null>(null);
  const wasRunning = useRef(false);
  const poll = useCallback(async () => {
    const s = await api.scrapeStatus().catch(() => null);
    if (!s) return;
    setStatus(s);
    if (wasRunning.current && !s.running) {
      onFinished();
      toast.success(`Scrape finished: +${s.added} new, ${s.updated} refreshed, ${s.gone} removed${s.errors ? `, ${s.errors} errors` : ""}`);
    }
    wasRunning.current = s.running;
  }, [onFinished]);
  useEffect(() => {
    poll();
    const t = setInterval(poll, status?.running ? 1500 : 8000);
    return () => clearInterval(t);
  }, [poll, status?.running]);
  const start = async (mode: "quick" | "full") => {
    try {
      await api.scrape(mode);
      wasRunning.current = true;
      toast.info(mode === "full" ? "Full scan started — this sweeps every job page politely and can take ~15 minutes the first time." : "Checking for new jobs…");
      poll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return { status, start, cancel: () => api.cancelScrape().then(poll) };
}

export function ScrapeButton({ status, start, cancel }: ReturnType<typeof useScrapeStatus>) {
  if (status?.running) {
    const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
    return (
      <div className="flex items-center gap-2">
        <div className="hidden w-40 sm:block">
          <Progress value={pct} />
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {status.phase === "listing" ? "reading listings…" : `${status.done}/${status.total} · +${status.added}`}
        </span>
        <Button variant="outline" size="sm" onClick={cancel}>
          <Square /> Stop
        </Button>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          {status?.running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Scrape
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={() => start("quick")} className="flex-col items-start gap-0.5">
          <span className="font-medium">Check for new jobs</span>
          <span className="text-muted-foreground text-xs">Reads your source link(s) and fetches unseen jobs. ~1 min.</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => start("full")} className="flex-col items-start gap-0.5">
          <span className="font-medium">Full scan</span>
          <span className="text-muted-foreground text-xs">Sweeps all job pages (sweep depth in Settings) and refreshes stale ones.</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ScrapeLog({ status }: { status: ScrapeStatus | null }) {
  if (!status?.log.length) return <p className="text-muted-foreground text-sm">No scrape has run since the server started.</p>;
  return (
    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed">{status.log.slice().reverse().join("\n")}</pre>
  );
}
