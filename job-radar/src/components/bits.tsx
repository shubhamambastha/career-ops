import { TRACK_STATUSES, type Eligibility, type ScoreBreakdown, type TrackStatus } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  remote_ok: "Can apply",
  home_onsite: "Relocate",
  unclear: "Unclear",
  blocked: "Not eligible",
};

export function EligibilityBadge({ e, reason }: { e: Eligibility; reason?: string }) {
  const variant = e === "remote_ok" ? "success" : e === "home_onsite" ? "secondary" : e === "unclear" ? "warning" : "destructive";
  const badge = <Badge variant={variant}>{ELIGIBILITY_LABEL[e]}</Badge>;
  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

const TIER_CLASS: Record<string, string> = {
  A: "bg-emerald-600 text-white",
  B: "bg-sky-600 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-zinc-400 text-white dark:bg-zinc-600",
};

export function ScoreCell({ s }: { s: ScoreBreakdown }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 tabular-nums">
          <span className={cn("inline-flex size-6 items-center justify-center rounded text-xs font-semibold", TIER_CLASS[s.tier])}>{s.tier}</span>
          <span className="font-semibold">{s.total.toFixed(0)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <ScoreBreakdownView s={s} />
      </TooltipContent>
    </Tooltip>
  );
}

export function ScoreBreakdownView({ s }: { s: ScoreBreakdown }) {
  const parts: Array<[string, number]> = [
    ["Skills", s.parts.skills],
    ["Location", s.parts.location],
    ["Seniority", s.parts.seniority],
    ["Focus", s.parts.focus],
    ["Recency", s.parts.recency],
  ];
  return (
    <div className="grid min-w-52 gap-1.5">
      {parts.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[70px_1fr_28px] items-center gap-2">
          <span className="text-muted-foreground">{k}</span>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-foreground/70 h-full" style={{ width: `${v}%` }} />
          </div>
          <span className="text-right tabular-nums">{v}</span>
        </div>
      ))}
      {s.adjustments.map((a) => (
        <div key={a.label} className="flex justify-between">
          <span className="text-muted-foreground">{a.label}</span>
          <span className={cn("tabular-nums", a.points < 0 ? "text-destructive" : "text-success")}>
            {a.points > 0 ? "+" : ""}
            {a.points}
          </span>
        </div>
      ))}
      <div className="text-muted-foreground border-t pt-1.5">{s.eligibilityReason}</div>
    </div>
  );
}

const STATUS_DOT: Record<TrackStatus, string> = {
  New: "bg-zinc-300",
  Shortlisted: "bg-violet-500",
  Applied: "bg-sky-500",
  Responded: "bg-cyan-500",
  Interview: "bg-amber-500",
  Offer: "bg-emerald-500",
  Rejected: "bg-red-500",
  Discarded: "bg-zinc-500",
};

export function StatusDot({ s }: { s: TrackStatus }) {
  return <span className={cn("inline-block size-2 rounded-full", STATUS_DOT[s])} />;
}

export function StatusSelect({ value, onChange, className }: { value: TrackStatus; onChange: (s: TrackStatus) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TrackStatus)}>
      <SelectTrigger size="sm" className={cn("w-36", className)} onClick={(e) => e.stopPropagation()}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {TRACK_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <StatusDot s={s} /> {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ago(days: number | null) {
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
