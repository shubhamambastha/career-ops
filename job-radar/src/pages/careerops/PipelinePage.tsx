import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import type { TrackerRow } from "@shared/types";
import { api } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  applied: "secondary",
  responded: "secondary",
  interview: "warning",
  offer: "success",
  hired: "success",
  rejected: "destructive",
  discarded: "outline",
  skip: "outline",
};

export function PipelinePage() {
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<TrackerRow | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .tracker()
      .then((d) => {
        setRows(d.rows);
        setStates(d.states);
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    setReport(null);
    const m = open?.report.match(/\]\(([^)]+)\)/);
    if (!m) return;
    const path = m[1].replace(/^(\.\.\/)+/, "");
    api
      .coFile(path)
      .then((d) => setReport(d.content))
      .catch(() => setReport("_Report file not found._"));
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.status.toLowerCase() === status.toLowerCase()) && (!s || `${r.company} ${r.role} ${r.notes}`.toLowerCase().includes(s)));
  }, [rows, q, status]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
    return c;
  }, [rows]);

  const change = async (r: TrackerRow, state: string) => {
    try {
      await api.setTrackerStatus(r.num, state);
      toast.success(`#${r.num} ${r.company} → ${state}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {states
          .filter((s) => counts[s])
          .map((s) => (
            <Card key={s} className="cursor-pointer gap-1 px-4 py-3" onClick={() => setStatus(status === s ? "all" : s)}>
              <div className="text-muted-foreground text-xs">{s}</div>
              <div className="text-2xl font-semibold tabular-nums">{counts[s]}</div>
            </Card>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role, notes…" className="h-8 pl-8" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
          <RefreshCw /> Reload
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        This is career-ops' <code>data/applications.md</code>. Status changes go through <code>set-status.mjs</code> (locked, validated, logged to status-log.tsv). Jobs you mark
        Applied in Job Radar are added here automatically (Settings → career-ops).
      </p>
      <div className="min-w-0 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Company / role</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>PDF</TableHead>
              <TableHead>Report</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={`${r.num}-${r.company}`} className="cursor-pointer" onClick={() => setOpen(r)}>
                <TableCell className="text-muted-foreground tabular-nums">{r.num}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{r.date}</TableCell>
                <TableCell>
                  <div className="font-medium">{r.company}</div>
                  <div className="text-muted-foreground max-w-80 truncate text-xs">{r.role}</div>
                </TableCell>
                <TableCell className="tabular-nums">{r.score}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Select value={states.find((s) => s.toLowerCase() === r.status.toLowerCase()) || r.status} onValueChange={(v) => change(r, v)}>
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {states.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>{r.pdf}</TableCell>
                <TableCell>{r.reportNum ? <Badge variant="outline">#{r.reportNum}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-muted-foreground max-w-96 truncate text-xs" title={r.notes}>
                  {r.notes}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground h-24 text-center">
                  {rows.length ? "No rows match." : "The career-ops tracker is empty."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-3xl">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>
                  #{open.num} {open.company}
                </SheetTitle>
                <SheetDescription>
                  {open.role} · {open.status} · {open.score}
                </SheetDescription>
                {open.status && (
                  <Badge variant={STATUS_VARIANT[open.status.toLowerCase()] || "secondary"} className="w-fit">
                    {open.status}
                  </Badge>
                )}
              </SheetHeader>
              <div className="grid gap-3 px-5 pb-8">
                {open.notes && <p className="text-sm">{open.notes}</p>}
                {report ? <Markdown text={report} /> : <p className="text-muted-foreground text-sm">{open.reportNum ? "Loading report…" : "No evaluation report for this row."}</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
