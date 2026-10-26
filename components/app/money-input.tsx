"use client";

import * as React from "react";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { usePreferences } from "@/components/providers/app-context";

const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code;
}

/** Amount entry: decimal keypad on phones, currency prefix, tabular figures. */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
    allowNegative?: boolean;
  }
>(({ value, onValueChange, allowNegative, className, ...props }, ref) => {
  const { currency } = usePreferences();
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
        {currencySymbol(currency)}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          const cleaned = e.target.value.replace(allowNegative ? /[^\d.,-]/g : /[^\d.,]/g, "");
          onValueChange(cleaned);
        }}
        className={cn(inputClass, "num pl-7", className)}
        {...props}
      />
    </div>
  );
});
MoneyInput.displayName = "MoneyInput";
