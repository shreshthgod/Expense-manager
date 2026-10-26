import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-primary-soft text-primary",
      secondary: "bg-secondary text-secondary-foreground",
      outline: "border text-foreground",
      inflow: "bg-inflow-soft text-inflow",
      outflow: "bg-outflow-soft text-outflow",
      warning: "bg-warning-soft text-warning",
      destructive: "bg-outflow-soft text-outflow",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
