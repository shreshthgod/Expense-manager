"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Avatar with initials fallback. External avatar URLs are https-only (validated
 * server-side) and requested without a referrer.
 */
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <span className={cn("relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-xs font-semibold text-primary", className)}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied https URL; next/image would need open remotePatterns
        <img src={src} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials || "?"}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
