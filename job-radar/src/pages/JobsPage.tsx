import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Filter, Link2, Mail, MoreHorizontal, Search, Star, X } from "lucide-react";
import { TRACK_STATUSES, type Eligibility, type Focus, type TrackStatus } from "@shared/types";
import type { Row } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { ago, ELIGIBILITY_LABEL, EligibilityBadge, ScoreCell, StatusDot, StatusSelect } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SwitchField } from "@/components/Fields";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";

interface Filters {
  q: string;
  tiers: string[];
  elig: Eligibility[];
  focus: Focus[];
  statuses: TrackStatus[];
  maxDays: number;
  minScore: number;
  starred: boolean;
  hasEmail: boolean;
  showGone: boolean;
}

const DEFAULT_FILTERS: Filters = {
  q: "",
  tiers: [],
  elig: [],
  focus: [],
  statuses: [],
  maxDays: 0,
  minScore: 0,
  starred: false,
  hasEmail: false,
  showGone: false,
};

function useStoredState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV] as const;
}

function MultiFilter<T extends string>({ label, options, value, onChange, render }: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (o: T) => React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("border-dashed", value.length && "border-solid")}>
          <Filter /> {label}
          {value.length > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5">
              {value.length}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o}
            checked={value.includes(o)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(c) => onChange(c ? [...value, o] : value.filter((x) => x !== o))}
          >
            {render ? render(o) : o}
          </DropdownMenuCheckboxItem>
        ))}
        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>Clear</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toCsv(rows: Row[]) {
  const head = ["rank", "score", "tier", "title", "company", "eligibility", "focus", "location", "salary", "min_years", "posted", "status", "applied_at", "suggested_resume", "matched_skills", "missing_skills", "url"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.rank,
      r.score.total,
      r.score.tier,
      r.job.title,
      r.job.company,
      ELIGIBILITY_LABEL[r.score.eligibility],
      r.score.focus,
      r.job.location,
      r.job.salaryText,
      r.job.minYears ?? "",
      r.job.postedAt ?? "",
      r.status,
      r.tracking?.appliedAt ?? "",
      r.resume.resume?.label ?? "",
      r.score.matchedSkills.join("; "),
      r.score.missingSkills.join("; "),
      r.job.url,
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

interface Props {
  rows: Row[];
  hideBlocked: boolean;
  hideGone: boolean;
  onOpen: (row: Row) => void;
  onApply: (row: Row, mode: "link" | "email") => void;
  onStatus: (jobId: string, status: TrackStatus) => void;
  onStar: (row: Row) => void;
  trackerView?: boolean;
}

export function JobsPage({ rows, hideBlocked, hideGone, onOpen, onApply, onStatus, onStar, trackerView }: Props) {
  const [f, setF] = useStoredState<Filters>(trackerView ? "jr.filters.tracker" : "jr.filters.jobs", DEFAULT_FILTERS);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useStoredState<VisibilityState>("jr.columns", { location: false, salary: false });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (trackerView && r.status === "New" && !r.tracking?.starred) return false;
      if (hideGone && !f.showGone && r.job.status === "gone" && !r.tracking) return false;
      if (hideBlocked && !trackerView && r.score.eligibility === "blocked" && !f.elig.includes("blocked")) return false;
      if (q && !`${r.job.title} ${r.job.company} ${r.job.skills.join(" ")} ${r.job.location}`.toLowerCase().includes(q)) return false;
      if (f.tiers.length && !f.tiers.includes(r.score.tier)) return false;
      if (f.elig.length && !f.elig.includes(r.score.eligibility)) return false;
      if (f.focus.length && !f.focus.includes(r.score.focus)) return false;
      if (f.statuses.length && !f.statuses.includes(r.status)) return false;
      if (f.maxDays && (r.score.daysOld == null || r.score.daysOld > f.maxDays)) return false;
      if (f.minScore && r.score.total < f.minScore) return false;
      if (f.starred && !r.tracking?.starred) return false;
      if (f.hasEmail && !r.job.emails.length) return false;
      return true;
    });
  }, [rows, f, hideBlocked, hideGone, trackerView]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "star",
        header: () => <Star className="size-3.5" />,
        cell: ({ row }) => (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onStar(row.original);
            }}
          >
            <Star className={cn("size-4", row.original.tracking?.starred && "fill-amber-400 text-amber-400")} />
          </button>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      { id: "rank", header: "#", accessorFn: (r) => r.rank, cell: ({ getValue }) => <span className="text-muted-foreground tabular-nums">{getValue<number>()}</span> },
      { id: "score", header: "Score", accessorFn: (r) => r.score.total, cell: ({ row }) => <ScoreCell s={row.original.score} /> },
      {
        id: "role",
        header: "Role",
        accessorFn: (r) => r.job.title,
        cell: ({ row }) => (
          <div className="max-w-md min-w-56">
            <div className="truncate font-medium" title={row.original.job.title}>
              {row.original.job.title}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {row.original.job.company}
              {row.original.job.status === "gone" && <span className="text-destructive"> · removed</span>}
            </div>
          </div>
        ),
      },
      {
        id: "eligibility",
        header: "Eligibility",
        accessorFn: (r) => r.score.eligibility,
        cell: ({ row }) => <EligibilityBadge e={row.original.score.eligibility} reason={row.original.score.eligibilityReason} />,
      },
      { id: "focus", header: "Focus", accessorFn: (r) => r.score.focus, cell: ({ getValue }) => <Badge variant="outline">{getValue<string>()}</Badge> },
      {
        id: "skills",
        header: "Skills match",
        accessorFn: (r) => r.score.parts.skills,
        cell: ({ row }) => (
          <div className="flex max-w-64 flex-wrap gap-1">
            {row.original.score.matchedSkills.slice(0, 4).map((s) => (
              <Badge key={s} variant="success" className="px-1.5">
                {s}
              </Badge>
            ))}
            {row.original.score.missingSkills.length > 0 && (
              <Badge variant="outline" className="text-muted-foreground px-1.5" title={row.original.score.missingSkills.join(", ")}>
                +{row.original.score.missingSkills.length} gap
              </Badge>
            )}
          </div>
        ),
      },
      { id: "location", header: "Location", accessorFn: (r) => r.job.location, cell: ({ getValue }) => <span className="line-clamp-2 max-w-64 text-xs" title={getValue<string>()}>{getValue<string>()}</span> },
      { id: "salary", header: "Salary", accessorFn: (r) => r.job.salaryText, cell: ({ getValue }) => <span className="line-clamp-2 max-w-64 text-xs" title={getValue<string>()}>{getValue<string>()}</span> },
      { id: "exp", header: "Exp.", accessorFn: (r) => r.job.minYears ?? -1, cell: ({ row }) => <span className="tabular-nums">{row.original.job.minYears != null ? `${row.original.job.minYears}+` : "—"}</span> },
      {
        id: "resume",
        header: "Resume",
        accessorFn: (r) => r.resume.resume?.label ?? "",
        cell: ({ row }) => <span className="text-xs whitespace-nowrap">{row.original.tracking?.resumeId ? `✓ ${row.original.tracking.resumeId.replace(/^output:/, "")}` : row.original.resume.resume?.label}</span>,
      },
      { id: "posted", header: "Posted", accessorFn: (r) => -(r.score.daysOld ?? 9999), cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{ago(row.original.score.daysOld)}</span> },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => TRACK_STATUSES.indexOf(r.status),
        cell: ({ row }) => <StatusSelect value={row.original.status} onChange={(s) => onStatus(row.original.job.id, s)} />,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onApply(row.original, "link")}>
                <Link2 /> Apply via link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onApply(row.original, "email")}>
                <Mail /> Apply by email {row.original.job.emails.length ? "" : "(no address)"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onStatus(row.original.job.id, "Shortlisted")}>Shortlist</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onStatus(row.original.job.id, "Discarded")} variant="destructive">
                Discard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onApply, onStatus, onStar],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
    autoResetPageIndex: false,
  });

  useEffect(() => table.setPageIndex(0), [f]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);
  const stats = useMemo(() => {
    const byTier = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>;
    filtered.forEach((r) => byTier[r.score.tier]++);
    return byTier;
  }, [filtered]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(table.getSortedRowModel().rows.map((r) => r.original))], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `job-radar-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search title, company, skill…" className="h-8 pl-8" />
        </div>
        <MultiFilter label="Tier" options={["A", "B", "C", "D"] as const} value={f.tiers} onChange={(v) => set("tiers", v)} />
        <MultiFilter
          label="Eligibility"
          options={["remote_ok", "home_onsite", "unclear", "blocked"] as const}
          value={f.elig}
          onChange={(v) => set("elig", v)}
          render={(o) => ELIGIBILITY_LABEL[o]}
        />
        <MultiFilter label="Focus" options={["backend", "fullstack", "frontend", "other"] as const} value={f.focus} onChange={(v) => set("focus", v)} />
        <MultiFilter
          label="Status"
          options={TRACK_STATUSES}
          value={f.statuses}
          onChange={(v) => set("statuses", v)}
          render={(o) => (
            <span className="flex items-center gap-2">
              <StatusDot s={o} /> {o}
            </span>
          )}
        />
        <Select value={String(f.maxDays)} onValueChange={(v) => set("maxDays", Number(v))}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any date</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 6 months</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={cn("border-dashed", (f.minScore || f.starred || f.hasEmail || f.showGone) && "border-solid")}>
              <Filter /> More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 p-3">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label className="justify-between">
                  Min score <span className="tabular-nums">{f.minScore}</span>
                </Label>
                <Slider value={[f.minScore]} max={100} step={5} onValueChange={([v]) => set("minScore", v)} />
              </div>
              <SwitchField labelFirst label="Starred only" checked={f.starred} onChange={(v) => set("starred", v)} />
              <SwitchField labelFirst label="Has recruiter email" checked={f.hasEmail} onChange={(v) => set("hasEmail", v)} />
              <SwitchField labelFirst label="Show removed jobs" checked={f.showGone} onChange={(v) => set("showGone", v)} />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => setF(DEFAULT_FILTERS)}>
            Reset <X />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onSelect={(e) => e.preventDefault()} onCheckedChange={(v) => c.toggleVisibility(!!v)} className="capitalize">
                    {c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download /> CSV
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
        <span>
          <span className="text-foreground font-medium">{filtered.length}</span> of {rows.length} jobs
        </span>
        {Object.entries(stats).map(([t, n]) => (
          <span key={t}>
            Tier {t}: <span className="text-foreground tabular-nums">{n}</span>
          </span>
        ))}
        {hideBlocked && !trackerView && <span>· not-eligible jobs hidden (Settings)</span>}
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button className="hover:text-foreground inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown className={cn("size-3", h.column.getIsSorted() ? "opacity-100" : "opacity-30")} />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className={cn("cursor-pointer", row.original.job.status === "gone" && "opacity-60")} onClick={() => onOpen(row.original)}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-muted-foreground h-32 text-center">
                  {rows.length ? "No jobs match these filters." : trackerView ? "Nothing tracked yet — star, shortlist or apply to a job." : "No jobs yet — click Scrape to fetch jobs."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
