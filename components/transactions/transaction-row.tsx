"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CalendarClock, Paperclip, RotateCcw, Scale, Split } from "lucide-react";
import { Amount } from "@/components/app/amount";
import { Badge } from "@/components/ui/badge";
import { Swatch } from "@/components/app/kit";
import { useFormat } from "@/components/providers/app-context";
import type { TransactionDTO } from "@/server/services/transaction.types";
import { cn } from "@/lib/utils/cn";

const ICONS = { EXPENSE: ArrowUpRight, INCOME: ArrowDownLeft, TRANSFER: ArrowRightLeft, ADJUSTMENT: Scale, REFUND: RotateCcw } as const;

export function transactionTitle(t: TransactionDTO): string {
  if (t.type === "TRANSFER") return t.description ?? `${t.account?.name ?? "?"} → ${t.destinationAccount?.name ?? "?"}`;
  if (t.type === "ADJUSTMENT") return t.description ?? "Balance adjustment";
  return t.merchantName ?? t.merchant ?? t.description ?? t.category?.name ?? (t.type === "INCOME" ? "Income" : "Expense");
}

/** Direction of the money for display (relative to an account when given). */
export function transactionDirection(t: TransactionDTO): "in" | "out" | "neutral" {
  if (t.accountEffect != null) return t.accountEffect > 0 ? "in" : t.accountEffect < 0 ? "out" : "neutral";
  if (t.type === "INCOME" || t.type === "REFUND") return "in";
  if (t.type === "EXPENSE") return "out";
  if (t.type === "ADJUSTMENT") return t.destinationAccountId ? "in" : "out";
  return "neutral";
}

export function TransactionRow({
  t,
  onOpen,
  selectable,
  selected,
  onSelect,
  showDate = true,
  className,
}: {
  t: TransactionDTO;
  onOpen?: (t: TransactionDTO) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  showDate?: boolean;
  className?: string;
}) {
  const f = useFormat();
  const Icon = ICONS[t.type];
  const dir = transactionDirection(t);
  const sub = [
    t.type === "TRANSFER" ? "Transfer" : t.isSplit ? `Split · ${t.splits.length} categories` : t.category?.name ?? (t.type === "EXPENSE" || t.type === "INCOME" ? "Uncategorised" : null),
    t.type === "TRANSFER" ? null : t.account?.name,
    showDate ? f.relative(t.transactionDate) : null,
  ].filter(Boolean);
  return (
    <div className={cn("group flex scroll-mt-28 items-center gap-3 px-3 py-2.5 sm:px-4", selected && "bg-primary-soft/60", className)}>
      {selectable && (
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={!!selected}
          onChange={(e) => onSelect?.(e.target.checked)}
          aria-label={`Select ${transactionTitle(t)}, ${f.money(t.amount)}`}
        />
      )}
      <button
        type="button"
        onClick={() => onOpen?.(t)}
        disabled={!onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            dir === "in" ? "bg-inflow-soft text-inflow" : dir === "out" ? "bg-outflow-soft text-outflow" : "bg-muted text-muted-foreground"
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{transactionTitle(t)}</span>
            {t.status === "PLANNED" && (
              <Badge variant="warning" className="shrink-0">
                <CalendarClock className="h-3 w-3" aria-hidden="true" /> Planned
              </Badge>
            )}
            {t.isSplit && <Split className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Split" />}
            {t.attachmentCount > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Has attachments" />}
            {t.refundedAmount > 0 && <Badge variant="inflow" className="shrink-0">Refunded {f.money(t.refundedAmount)}</Badge>}
          </span>
          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {t.category && !t.isSplit && t.type !== "TRANSFER" && <Swatch color={t.category.color} className="h-2 w-2" />}
            {sub.join(" · ")}
          </span>
        </span>
        <Amount value={t.accountEffect != null ? Math.abs(t.accountEffect) : t.amount} direction={dir} className="text-sm font-semibold" />
      </button>
    </div>
  );
}
