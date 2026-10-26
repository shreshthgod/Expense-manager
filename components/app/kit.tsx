"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** A labelled figure. Keep labels short; the value carries the weight. */
export function StatTile({
  label,
  value,
  hint,
  className,
  emphasis,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-4", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("mt-1 break-words font-semibold leading-tight num", emphasis ? "text-2xl" : "text-xl")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Radio-group styled as a segmented control (arrow keys move the selection). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  label: string;
  className?: string;
  size?: "sm" | "xs";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 scrollbar-thin", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length]!;
        onChange(next.value);
        (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={o.value}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "shrink-0 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
              selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * State mirrored in the URL (?key=value) so filters survive reloads, back/forward
 * and can be shared. Setting the default value removes the parameter.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = React.useMemo(() => {
    const out: Record<string, string> = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v != null) out[k] = v;
    }
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const set = React.useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "" || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, pathname, router]
  );
  return [values, set] as const;
}

/** "How is this calculated?" — every derived figure can show its formula and inputs. */
export function Explain({ title = "How is this calculated?", children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className={cn("text-sm", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="mt-2 animate-fade-in rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/** Percentage change with direction wording (never colour alone). */
export function Delta({ value, goodWhen = "down", suffix = "vs previous" }: { value: number | null | undefined; goodWhen?: "up" | "down"; suffix?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-muted-foreground">No comparison</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  const good = flat ? null : goodWhen === "up" ? up : !up;
  return (
    <span className={cn("whitespace-nowrap text-xs num", good === true && "text-inflow", good === false && "text-outflow", good === null && "text-muted-foreground")}>
      {flat ? "No change" : `${up ? "▲" : "▼"} ${Math.abs(value).toFixed(1)}%`} <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-2", className)}>
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** Small coloured dot for categories (decorative; the name is always shown). */
export function Swatch({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40", className)} style={color ? { backgroundColor: color } : undefined} />;
}
