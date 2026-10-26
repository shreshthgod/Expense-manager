import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate, type ISODate } from "@/lib/dates/date-only";
import { round2 } from "@/lib/utils/money";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getFinancialSummary } from "@/server/analytics/summary";
import { getCategoryBreakdown } from "@/server/analytics/categories";
import { getBudgetStatuses } from "@/server/analytics/budget-status";
import { detectRecentAnomalies } from "@/server/analytics/detect";
import { forecastSpending } from "@/server/analytics/forecast";
import { evaluateAffordability } from "@/server/analytics/affordability";
import { getTopMerchants } from "@/server/analytics/merchants";
import { listGoals } from "@/server/services/goal.service";
import { listRecurring } from "@/server/services/recurring.service";
import { getBalanceSummary, listAccounts } from "@/server/services/account.service";
import type { UserSettings } from "@/server/services/user-settings.service";

/**
 * Trusted, deterministic tools the AI layer may call. Every tool is READ_ONLY:
 * it computes numbers from the user's data; the model only explains outputs.
 * No tool writes financial records — AI-proposed changes become drafts the
 * user must confirm through the normal validated APIs.
 */

export type ToolPermission = "READ_ONLY";

export interface ToolContext {
  userId: string;
  settings: UserSettings;
  today: ISODate;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  permission: ToolPermission;
  inputSchema: z.ZodType<I>;
  execute: (ctx: ToolContext, input: I) => Promise<O>;
}

const emptyInput = z.object({}).strict();
const periodInput = z.object({
  preset: z.enum(["this_week", "this_month", "last_month", "3_months", "6_months", "this_year"]).default("this_month"),
});

function period(ctx: ToolContext, preset: z.infer<typeof periodInput>["preset"]) {
  return resolvePeriod(preset, ctx.today, ctx.settings);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolRegistry: Record<string, ToolDefinition<any, any>> = {
  get_user_financial_summary: {
    name: "get_user_financial_summary",
    description: "Income, gross spending, refunds, net spending, surplus and savings rate for a period, with the previous period.",
    permission: "READ_ONLY",
    inputSchema: periodInput,
    execute: async (ctx, input) => {
      const p = period(ctx, input.preset);
      const s = await getFinancialSummary(ctx.userId, p);
      return {
        period: s.period,
        previousPeriod: s.previousPeriod,
        income: s.current.income,
        grossSpending: s.current.grossExpense,
        refunds: s.current.refunds,
        netSpending: s.current.netSpending,
        surplus: s.current.surplus,
        savingsRatePct: s.current.savingsRate,
        transactionCount: s.current.transactionCount,
        previous: {
          income: s.previous.income,
          netSpending: s.previous.netSpending,
          surplus: s.previous.surplus,
          savingsRatePct: s.previous.savingsRate,
        },
        changes: s.changes,
      };
    },
  },

  get_account_balances: {
    name: "get_account_balances",
    description: "Current liquid funds, total assets, total liabilities, net worth and per-account balances.",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => {
      const [summary, accounts] = await Promise.all([getBalanceSummary(ctx.userId), listAccounts(ctx.userId, { includeArchived: true })]);
      return {
        ...summary,
        accounts: accounts.map((a) => ({ name: a.name, type: a.type, group: a.group, balance: a.balance, outstanding: a.outstanding, archived: a.archived })),
      };
    },
  },

  get_transactions: {
    name: "get_transactions",
    description: "Recent posted transactions (max 20), optionally filtered by type.",
    permission: "READ_ONLY",
    inputSchema: z.object({ type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).optional(), limit: z.number().int().min(1).max(20).default(10) }),
    execute: async (ctx, input) => {
      const rows = await prisma.transaction.findMany({
        where: { userId: ctx.userId, deletedAt: null, status: "POSTED", ...(input.type ? { type: input.type } : {}) },
        include: { category: { select: { name: true } } },
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        take: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        date: fromDbDate(r.transactionDate),
        merchant: r.merchant,
        description: r.description,
        category: r.category?.name ?? null,
        amount: Number(r.amount),
        type: r.type,
      }));
    },
  },

  get_expenses_by_category: {
    name: "get_expenses_by_category",
    description: "Net spending by category for a period with share of spending and change vs the previous period.",
    permission: "READ_ONLY",
    inputSchema: periodInput,
    execute: async (ctx, input) => {
      const p = period(ctx, input.preset);
      const rows = await getCategoryBreakdown(ctx.userId, p.range, p.previous, "EXPENSE");
      return rows.map((c) => ({
        categoryId: c.categoryId,
        category: c.name,
        total: c.total,
        refunds: c.refunds,
        percentageOfSpending: c.percentage,
        transactions: c.count,
        averageTransaction: c.averageTransaction,
        previousTotal: c.previousTotal,
        changeVsPreviousPeriodPct: c.changePct,
      }));
    },
  },

  get_income_summary: {
    name: "get_income_summary",
    description: "Income by source/category for a period.",
    permission: "READ_ONLY",
    inputSchema: periodInput,
    execute: async (ctx, input) => {
      const p = period(ctx, input.preset);
      const rows = await getCategoryBreakdown(ctx.userId, p.range, p.previous, "INCOME");
      return rows.map((c) => ({ source: c.name, total: c.total, previousTotal: c.previousTotal, changePct: c.changePct }));
    },
  },

  get_top_merchants: {
    name: "get_top_merchants",
    description: "Merchants with the highest net spending in a period.",
    permission: "READ_ONLY",
    inputSchema: periodInput,
    execute: async (ctx, input) => {
      const p = period(ctx, input.preset);
      return getTopMerchants(ctx.userId, p.range, p.previous, 8);
    },
  },

  get_budget_status: {
    name: "get_budget_status",
    description: "Active budgets for their current cycle: limit, spent, remaining, utilization, pace and days left.",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => {
      const rows = await getBudgetStatuses(ctx.userId, ctx.today, { weekStartsOn: ctx.settings.weekStartsOn });
      return rows.map((b) => ({
        id: b.id,
        name: b.name,
        categoryId: b.categoryId,
        category: b.categoryName,
        amount: b.amount,
        available: b.available,
        spent: b.spent,
        remaining: b.remaining,
        utilization: b.utilization,
        exceeded: b.exceeded,
        cycle: b.cycle,
        elapsedPct: b.elapsedPct,
        projectedSpend: b.projectedSpend,
        daysRemaining: b.daysRemaining,
      }));
    },
  },

  get_goal_status: {
    name: "get_goal_status",
    description: "Savings goals with progress, deadlines, remaining amounts and required monthly saving.",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => listGoals(ctx.userId, ctx.today),
  },

  get_recurring_transactions: {
    name: "get_recurring_transactions",
    description: "Active recurring items, bills and subscriptions with monthly equivalents.",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => {
      const items = await listRecurring(ctx.userId, { includeInactive: false, today: ctx.today });
      const expenses = items.filter((i) => i.type === "EXPENSE");
      return {
        items: items.map((i) => ({
          name: i.name,
          kind: i.kind,
          type: i.type,
          amount: i.amount,
          frequency: i.frequency,
          interval: i.interval,
          monthlyEquivalent: i.monthlyEquivalent,
          nextDueDate: i.nextDueDate,
        })),
        totalMonthlyEquivalent: round2(expenses.reduce((a, i) => a + i.monthlyEquivalent, 0)),
      };
    },
  },

  compare_periods: {
    name: "compare_periods",
    description: "Category spending in a period vs the previous one, flagging significant changes (≥15% or ≥1000).",
    permission: "READ_ONLY",
    inputSchema: periodInput,
    execute: async (ctx, input) => {
      const p = period(ctx, input.preset);
      const rows = await getCategoryBreakdown(ctx.userId, p.range, p.previous, "EXPENSE");
      return rows.slice(0, 12).map((c) => ({
        category: c.name,
        current: c.total,
        previous: c.previousTotal,
        changePct: c.changePct,
        significant: c.changePct !== null && (Math.abs(c.changePct) >= 15 || Math.abs(c.total - c.previousTotal) >= 1000),
      }));
    },
  },

  calculate_savings_rate: {
    name: "calculate_savings_rate",
    description: "Average monthly income, net spending and surplus over recent complete months.",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => {
      const f = await forecastSpending(ctx.userId, ctx.today, ctx.settings);
      return {
        expectedMonthlyIncome: f.expectedMonthlyIncome,
        expectedMonthlyExpenses: f.expectedMonthlyExpenses,
        expectedMonthlySurplus: f.expectedMonthlySurplus,
        savingsRatePct: f.expectedMonthlyIncome > 0 ? round2((f.expectedMonthlySurplus / f.expectedMonthlyIncome) * 100) : null,
        dataQualityMonths: f.dataQualityMonths,
      };
    },
  },

  detect_anomalies: {
    name: "detect_anomalies",
    description: "Statistically unusual expenses in the last 30 days, with the evidence used.",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => detectRecentAnomalies(ctx.userId, ctx.today, 30),
  },

  calculate_affordability: {
    name: "calculate_affordability",
    description: "Deterministic affordability check for an amount against liquid funds and average monthly surplus.",
    permission: "READ_ONLY",
    inputSchema: z.object({ amount: z.number().positive() }),
    execute: async (ctx, input) => evaluateAffordability(ctx.userId, input.amount, ctx.today, ctx.settings),
  },

  generate_spending_forecast: {
    name: "generate_spending_forecast",
    description: "Deterministic projection of this month's spending and budgets at risk (an estimate).",
    permission: "READ_ONLY",
    inputSchema: emptyInput,
    execute: async (ctx) => forecastSpending(ctx.userId, ctx.today, ctx.settings),
  },
};

export type ToolResult = { tool: string; ok: boolean; data?: unknown; error?: string };

export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const tool = toolRegistry[name];
  if (!tool) return { tool: name, ok: false, error: `Unknown tool "${name}"` };
  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) return { tool: name, ok: false, error: `Invalid input for ${name}` };
  try {
    return { tool: name, ok: true, data: await tool.execute(ctx, parsed.data) };
  } catch (error) {
    console.error(`[tools] ${name} failed:`, error);
    return { tool: name, ok: false, error: "Tool execution failed" };
  }
}
