import { z } from "zod";
import { NextResponse } from "next/server";
import { searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { toCsv } from "@/lib/utils/csv";
import { transactionQuerySchema } from "@/lib/validation/schemas";
import { listAllMatching } from "@/server/services/transaction.service";
import { listBudgets } from "@/server/services/budget.service";
import { listAccounts } from "@/server/services/account.service";
import { listGoals } from "@/server/services/goal.service";
import { listRecurring } from "@/server/services/recurring.service";
import { audit } from "@/server/services/audit.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

const exportType = z.object({
  type: z.enum(["transactions", "budgets", "accounts", "goals", "subscriptions", "recurring"], {
    errorMap: () => ({ message: "Choose what to export: transactions, budgets, accounts, goals, subscriptions or recurring" }),
  }),
});

function csvResponse(name: string, body: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * CSV exports. Transactions honour the same filters as the list (all matching
 * rows, not just the loaded page). Text cells are formula-injection safe.
 */
export const GET = withAuth(async ({ request, userId }) => {
  const raw = searchParamsObject(request);
  const { type } = exportType.parse(raw);
  const settings = await getUserSettings(userId);
  const stamp = todayFor(settings);
  await audit({ userId, action: "DATA_EXPORTED", entity: "Export", metadata: { type } });

  if (type === "transactions") {
    // `type` selects the export; the transaction type filter travels as `transactionType`.
    const { type: _kind, transactionType, ...rest } = raw;
    const { page: _p, pageSize: _s, sortBy: _b, sortDir: _d, ...filters } = transactionQuerySchema.parse({ ...rest, type: transactionType, page: 1, pageSize: 20 });
    const rows = await listAllMatching(userId, filters);
    return csvResponse(
      `transactions-${stamp}.csv`,
      toCsv(
        ["date", "type", "status", "amount", "currency", "account", "to_account", "category", "merchant", "description", "payment_method", "tags", "notes", "id"],
        rows.map((t) => [
          t.transactionDate,
          t.type,
          t.status,
          t.amount,
          settings.currency,
          t.account?.name ?? "",
          t.destinationAccount?.name ?? "",
          t.category?.name ?? "",
          t.merchant,
          t.description,
          t.paymentMethod,
          t.tags.join("; "),
          t.notes,
          t.id,
        ])
      )
    );
  }
  if (type === "budgets") {
    const budgets = await listBudgets(userId);
    return csvResponse(
      `budgets-${stamp}.csv`,
      toCsv(
        ["name", "category", "period", "limit", "cycle_start", "cycle_end", "spent", "remaining", "utilization_pct", "state"],
        budgets.map((b) => [b.name, b.categoryName ?? "All spending", b.period, b.amount, b.cycle.start, b.cycle.lastDay, b.spent, b.remaining, b.utilization, b.cycle.state])
      )
    );
  }
  if (type === "accounts") {
    const accounts = await listAccounts(userId, { includeArchived: true });
    return csvResponse(
      `accounts-${stamp}.csv`,
      toCsv(
        ["name", "type", "group", "balance", "outstanding", "opening_balance", "opening_date", "currency", "institution", "archived"],
        accounts.map((a) => [a.name, a.type, a.group, a.balance, a.outstanding, a.openingBalance, a.openingDate, a.currency, a.institution, a.archived])
      )
    );
  }
  if (type === "goals") {
    const goals = await listGoals(userId);
    return csvResponse(
      `goals-${stamp}.csv`,
      toCsv(
        ["name", "target", "saved", "remaining", "progress_pct", "deadline", "required_monthly"],
        goals.map((g) => [g.name, g.targetAmount, g.currentAmount, g.remainingAmount, g.progressPct, g.deadline, g.requiredMonthlySaving])
      )
    );
  }
  const items = await listRecurring(userId, { kind: type === "subscriptions" ? "SUBSCRIPTION" : undefined });
  return csvResponse(
    `${type}-${stamp}.csv`,
    toCsv(
      ["name", "kind", "type", "amount", "frequency", "interval", "next_due", "monthly_equivalent", "annual_equivalent", "account", "category", "state"],
      items.map((r) => [r.name, r.kind, r.type, r.amount, r.frequency, r.interval, r.nextDueDate, r.monthlyEquivalent, r.annualEquivalent, r.accountName, r.categoryName, r.state])
    )
  );
});
