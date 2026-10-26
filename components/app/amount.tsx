"use client";

import { cn } from "@/lib/utils/cn";
import { useFormat } from "@/components/providers/app-context";

/**
 * A money figure. `direction` decides sign and semantic colour; colour is
 * never the only signal (the sign and screen-reader text carry it too).
 */
export function Amount({
  value,
  direction = "neutral",
  precise,
  compact,
  className,
}: {
  value: number;
  direction?: "in" | "out" | "neutral" | "auto";
  precise?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const f = useFormat();
  const dir = direction === "auto" ? (value > 0 ? "in" : value < 0 ? "out" : "neutral") : direction;
  const abs = Math.abs(value);
  const text = f.money(abs, { precise, compact });
  const sign = dir === "in" ? "+" : dir === "out" ? "−" : value < 0 ? "−" : "";
  return (
    <span className={cn("num whitespace-nowrap", dir === "in" && "text-inflow", dir === "out" && "text-outflow", className)}>
      <span aria-hidden="true">{sign}</span>
      {text}
      {dir !== "neutral" && <span className="sr-only">{dir === "in" ? " incoming" : " outgoing"}</span>}
    </span>
  );
}
