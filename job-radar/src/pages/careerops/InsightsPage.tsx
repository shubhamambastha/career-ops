import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { JsonView } from "@/components/JsonView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Insight = Awaited<ReturnType<typeof api.insight>>;

function InsightCard({ id, title, description, reloadKey }: { id: string; title: string; description: string; reloadKey: number }) {
  const [data, setData] = useState<Insight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    setData(null);
    setErr(null);
    api.insight(id).then(setData).catch((e) => setErr(e.message));
  }, [id, reloadKey]);
  const jsonErr = (data?.json as { error?: string } | null)?.error;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!data && !err && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> running {id}…
          </div>
        )}
        {err && <p className="text-destructive text-sm">{err}</p>}
        {data && data.json == null && !data.summary && <p className="text-muted-foreground text-sm">The script returned no output.</p>}
        {jsonErr && <p className="text-muted-foreground bg-muted/50 rounded-md p-3 text-sm">{jsonErr}</p>}
        {data?.summary && !jsonErr && <pre className="bg-muted/40 max-h-80 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{data.summary}</pre>}
        {data?.json != null && !jsonErr && (
          <>
            {data.summary ? (
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => setDetails(!details)}>
                {details ? <ChevronDown /> : <ChevronRight />} Details
              </Button>
            ) : null}
            {(details || !data.summary) && (
              <div className="max-h-[480px] overflow-auto">
                <JsonView data={data.json} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function InsightsPage() {
  const [list, setList] = useState<Array<{ id: string; title: string; description: string }>>([]);
  const [key, setKey] = useState(0);
  useEffect(() => {
    api.insights().then(setList).catch(() => null);
  }, []);
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-sm">Read-only reports from career-ops' own scripts — no AI, no cost. They get richer as your tracker fills up.</p>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setKey((k) => k + 1)}>
          <RefreshCw /> Refresh all
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((i) => (
          <InsightCard key={i.id} {...i} reloadKey={key} />
        ))}
      </div>
    </div>
  );
}
