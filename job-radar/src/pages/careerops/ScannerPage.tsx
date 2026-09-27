import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Play, Search } from "lucide-react";
import { toast } from "sonner";
import type { RunInfo, Settings } from "@shared/types";
import { api } from "@/lib/api";
import { RunViewer } from "@/components/RunViewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ScanRow = Awaited<ReturnType<typeof api.scanResults>>["rows"][number];

export function ScannerPage({ settings, onImported }: { settings: Settings; onImported: () => void }) {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    api.runs().then((r) => setRuns(r.filter((x) => x.kind === "scan"))).catch(() => null);
    api.scanResults().then((d) => setRows(d.rows)).catch(() => null);
  }, []);
  useEffect(load, [load]);

  const latest = runs[0];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => !s || `${r.title} ${r.company} ${r.location}`.toLowerCase().includes(s)).slice(0, 300);
  }, [rows, q]);

  const start = async () => {
    try {
      await api.startRun({ kind: "scan" });
      toast.success("Portal scan started");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const doImport = async () => {
    const r = await api.importScan().catch((e) => {
      toast.error(e.message);
      return null;
    });
    if (r) {
      toast.success(`${r.added} new jobs added to the Jobs table`);
      onImported();
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-4 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>career-ops portal scanner</CardTitle>
            <CardDescription>
              Runs <code>scan.mjs</code> (zero AI tokens) over the companies and job boards in career-ops <code>portals.yml</code> — Greenhouse, Ashby, Lever, Workable and more, filtered by
              your title/location filters. New postings are added to <code>data/pipeline.md</code> and imported into Job Radar's Jobs table, where they're ranked with everything else.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="text-muted-foreground text-xs">
              Window: last {settings.careerOps.scanSinceDays || "∞"} days{settings.careerOps.scanVerify ? " · verify links with Playwright" : ""} (change in Settings → career-ops)
            </div>
            <div className="flex gap-2">
              <Button onClick={start} disabled={latest?.status === "running" || latest?.status === "queued"}>
                <Play /> Run scan
              </Button>
              <Button variant="outline" onClick={doImport}>
                <Download /> Import results
              </Button>
            </div>
          </CardContent>
        </Card>
        {latest && (
          <Card>
            <CardContent>
              <RunViewer runId={latest.id} onChanged={() => { load(); onImported(); }} />
            </CardContent>
          </Card>
        )}
      </div>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Scan history ({rows.length})</CardTitle>
          <CardDescription>From data/scan-history.tsv, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-8 pl-8" />
          </div>
          <div className="min-w-0 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Seen</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.url}>
                    <TableCell>
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {r.title}
                      </a>
                      <div className="text-muted-foreground text-xs">{r.company}</div>
                    </TableCell>
                    <TableCell className="text-xs">{r.location}</TableCell>
                    <TableCell className="text-xs">{r.portal}</TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{r.firstSeen}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "added" ? "success" : "outline"}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground h-24 text-center">
                      No scan results yet — run a scan.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
