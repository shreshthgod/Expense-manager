"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Native checkbox (keyboard + screen reader correct) with custom visuals. */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked = false, indeterminate = false, onCheckedChange, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate;
    }, [indeterminate]);
    return (
      <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
        <input
          ref={inner}
          type="checkbox"
          className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-card checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 indeterminate:border-primary indeterminate:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          {...props}
        />
        {indeterminate ? (
          <Minus className="pointer-events-none relative m-auto h-3 w-3 text-primary-foreground" aria-hidden="true" />
        ) : (
          <Check className="pointer-events-none relative m-auto h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" aria-hidden="true" />
        )}
      </span>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
