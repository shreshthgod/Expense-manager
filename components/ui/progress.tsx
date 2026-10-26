"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** True value (may exceed 100). The bar is clamped visually; the label shows the real number. */
  value: number | null | undefined;
  tone?: "default" | "inflow" | "warning" | "outflow";
  label?: string;
}

const TONES = {
  default: "bg-primary",
  inflow: "bg-inflow",
  warning: "bg-warning",
  outflow: "bg-outflow",
} as const;

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(({ className, value, tone = "default", label, ...props }, ref) => {
  const real = Number.isFinite(value) ? (value as number) : 0;
  const clamped = Math.max(0, Math.min(100, real));
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={label ?? `${Math.round(real)}%`}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-[380ms] ease-out-soft motion-reduce:transition-none", TONES[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
});
Progress.displayName = "Progress";

export { Progress };
