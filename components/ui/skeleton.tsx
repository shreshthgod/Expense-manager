import { cn } from "@/lib/utils/cn";

/** Placeholder with the final layout's dimensions. Never show ₹0 while loading. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
