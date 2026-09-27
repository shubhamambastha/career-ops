import { cn } from "@/lib/utils";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const label = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");

function Scalar({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return <span>{v ? "yes" : "no"}</span>;
  if (typeof v === "number") return <span className="tabular-nums">{Number.isInteger(v) ? v : v.toFixed(2)}</span>;
  const s = String(v);
  if (/^https?:\/\//.test(s))
    return (
      <a href={s} target="_blank" rel="noreferrer" className="underline">
        {s.length > 60 ? s.slice(0, 60) + "…" : s}
      </a>
    );
  return <span>{s}</span>;
}

/** Generic renderer for career-ops script JSON: objects → key/value grids, arrays of objects → tables. */
export function JsonView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (Array.isArray(data)) {
    if (!data.length) return <span className="text-muted-foreground">none</span>;
    if (data.every((d) => !isObj(d) && !Array.isArray(d)))
      return (
        <div className="flex flex-wrap gap-1">
          {data.map((d, i) => (
            <span key={i} className="bg-muted rounded px-1.5 py-0.5 text-xs">
              <Scalar v={d} />
            </span>
          ))}
        </div>
      );
    const cols = [...new Set(data.filter(isObj).flatMap((d) => Object.keys(d)))].filter((c) => data.some((d) => isObj(d) && !isObj(d[c]) && !Array.isArray(d[c]))).slice(0, 8);
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              {cols.map((c) => (
                <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap capitalize">
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 200).map((row, i) => (
              <tr key={i} className="border-t">
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1.5 align-top">
                    {isObj(row) ? <Scalar v={row[c]} /> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (isObj(data)) {
    return (
      <div className={cn("grid gap-2", depth > 0 && "border-l pl-3")}>
        {Object.entries(data).map(([k, v]) =>
          isObj(v) || (Array.isArray(v) && v.some((x) => isObj(x))) ? (
            <div key={k} className="grid gap-1.5">
              <div className="text-muted-foreground text-xs font-medium uppercase">{label(k)}</div>
              <JsonView data={v} depth={depth + 1} />
            </div>
          ) : (
            <div key={k} className="grid grid-cols-[minmax(120px,220px)_1fr] gap-3 text-sm">
              <span className="text-muted-foreground capitalize">{label(k)}</span>
              {Array.isArray(v) ? <JsonView data={v} depth={depth + 1} /> : <Scalar v={v} />}
            </div>
          ),
        )}
      </div>
    );
  }
  return <Scalar v={data} />;
}
