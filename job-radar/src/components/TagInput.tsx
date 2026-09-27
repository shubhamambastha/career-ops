import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** Chip list editor: type and press Enter or comma to add; click × to remove. */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };
  return (
    <div className="grid gap-2">
      <Input
        value={draft}
        placeholder={placeholder ?? "Type and press Enter"}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
        className="h-8"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="hover:text-destructive rounded" aria-label={`Remove ${t}`}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
