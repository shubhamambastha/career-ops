import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// The control and its label are siblings linked by id/htmlFor (never a Radix button nested inside a <label>),
// so a click toggles exactly once in every browser.

export function CheckboxField({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  );
}

export function SwitchField({
  checked,
  onChange,
  label,
  className,
  labelFirst,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  className?: string;
  labelFirst?: boolean;
}) {
  const id = useId();
  const sw = <Switch id={id} checked={checked} onCheckedChange={onChange} />;
  const lbl = (
    <Label htmlFor={id} className="cursor-pointer">
      {label}
    </Label>
  );
  return (
    <div className={cn("flex items-center gap-3", labelFirst && "justify-between", className)}>
      {labelFirst ? (
        <>
          {lbl}
          {sw}
        </>
      ) : (
        <>
          {sw}
          {lbl}
        </>
      )}
    </div>
  );
}
