"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { qk } from "@/lib/client/query";
import type { AccountDTO, AccountDetailDTO, BalanceSummary } from "@/server/services/account.service";
import type { CategoryDTO } from "@/server/services/category.service";
import type { TransactionDTO, TransactionListTotals } from "@/server/services/transaction.types";
import type { BudgetStatus } from "@/server/analytics/budget-status";
import type { GoalStatus } from "@/server/services/goal.service";
import type { RecurringDTO, ScheduledItem } from "@/server/services/recurring.service";
import type { DashboardData } from "@/server/services/dashboard.service";
import type { NotificationDTO } from "@/server/services/notification.service";
import type { PreferencesDTO } from "@/server/services/preference.service";
import type { Paginated } from "@/types";
import type { InboxItem } from "@/server/services/inbox.service";
import type { SafeToSpend, CashFlowProjection, EmergencyFundStatus, NetWorthPoint } from "@/server/services/planning.service";
import type { MonthlyReview } from "@/server/services/review.service";
import type { BudgetTemplateDTO } from "@/server/services/budget-template.service";
import type { ContributionDTO } from "@/server/services/goal.service";
import type { CardStatement } from "@/server/services/account.service";


/** Typed data hooks. Keys are user-scoped (see lib/client/query.tsx). */

export type TransactionFilters = Record<string, string | number | boolean | undefined>;

export function useAccounts(opts: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: qk("accounts", "list", !!opts.includeArchived),
    queryFn: () => api.get<{ accounts: AccountDTO[]; summary: BalanceSummary }>("/api/accounts", { query: { includeArchived: opts.includeArchived } }),
  });
}

export function useAccount(id: string | null | undefined) {
  return useQuery({
    queryKey: qk("accounts", "detail", id),
    queryFn: () => api.get<AccountDetailDTO>(`/api/accounts/${id}`),
    enabled: !!id,
  });
}

export function useCategories(opts: { includeArchived?: boolean; withUsage?: boolean } = {}) {
  return useQuery({
    queryKey: qk("categories", "list", !!opts.includeArchived, !!opts.withUsage),
    queryFn: () => api.get<CategoryDTO[]>("/api/categories", { query: { includeArchived: opts.includeArchived, withUsage: opts.withUsage } }),
    staleTime: 5 * 60_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: qk("tags", "list"),
    queryFn: () => api.get<{ tag: string; count: number }[]>("/api/tags"),
    staleTime: 5 * 60_000,
  });
}

export function useTransactions(filters: TransactionFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk("transactions", "list", filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<TransactionDTO> & { totals: TransactionListTotals }>("/api/transactions", { query: filters, signal }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useTransaction(id: string | null | undefined) {
  return useQuery({
    queryKey: qk("transactions", "detail", id),
    queryFn: () => api.get<TransactionDTO>(`/api/transactions/${id}`),
    enabled: !!id,
  });
}

export function useBudgets() {
  return useQuery({ queryKey: qk("budgets", "list"), queryFn: () => api.get<BudgetStatus[]>("/api/budgets") });
}

export function useGoals() {
  return useQuery({ queryKey: qk("goals", "list"), queryFn: () => api.get<GoalStatus[]>("/api/goals") });
}

export function useRecurring(kind?: "STANDARD" | "BILL" | "SUBSCRIPTION") {
  return useQuery({
    queryKey: qk("recurring", "list", kind ?? "all"),
    queryFn: () => api.get<RecurringDTO[]>("/api/recurring", { query: { kind } }),
  });
}

export function useSchedule(from: string, to: string) {
  return useQuery({
    queryKey: qk("schedule", from, to),
    queryFn: () => api.get<ScheduledItem[]>("/api/schedule", { query: { from, to } }),
    placeholderData: keepPreviousData,
  });
}

export function useDashboard(period = "this_month") {
  return useQuery({
    queryKey: qk("dashboard", period),
    queryFn: () => api.get<DashboardData>("/api/dashboard", { query: { period } }),
    placeholderData: keepPreviousData,
  });
}

export function useNotifications(opts: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}) {
  return useQuery({
    queryKey: qk("notifications", opts),
    queryFn: () =>
      api.get<Paginated<NotificationDTO> & { unreadCount: number }>("/api/notifications", {
        query: { page: opts.page ?? 1, pageSize: opts.pageSize ?? 20, unreadOnly: opts.unreadOnly },
      }),
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
  });
}

export function usePreferencesQuery() {
  return useQuery({ queryKey: qk("preferences"), queryFn: () => api.get<PreferencesDTO>("/api/preferences") });
}

// ---------------------------------------------------------------------------
// Planning, analytics and management hooks
// ---------------------------------------------------------------------------

export function useInbox() {
  return useQuery({ queryKey: qk("inbox"), queryFn: () => api.get<{ items: InboxItem[]; total: number }>("/api/inbox") });
}

export function useSafeToSpend() {
  return useQuery({ queryKey: qk("schedule", "safe-to-spend"), queryFn: () => api.get<SafeToSpend>("/api/planning/safe-to-spend") });
}

export function useCashFlow(days: number, includeExpectedIncome: boolean) {
  return useQuery({
    queryKey: qk("schedule", "cash-flow", days, includeExpectedIncome),
    queryFn: () => api.get<CashFlowProjection>("/api/planning/cash-flow", { query: { days, includeExpectedIncome } }),
    placeholderData: keepPreviousData,
  });
}

export function useEmergencyFund() {
  return useQuery({ queryKey: qk("analytics", "emergency-fund"), queryFn: () => api.get<EmergencyFundStatus>("/api/planning/emergency-fund") });
}

export interface NetWorthResponse {
  summary: BalanceSummary;
  points: NetWorthPoint[];
  change: number;
  accounts: { id: string; name: string; type: string; group: "ASSET" | "LIABILITY"; balance: number; archived: boolean }[];
}

export function useNetWorth(months: number) {
  return useQuery({
    queryKey: qk("accounts", "net-worth", months),
    queryFn: () => api.get<NetWorthResponse>("/api/net-worth", { query: { months } }),
    placeholderData: keepPreviousData,
  });
}

export function useAccountHistory(id: string | null | undefined, days = 90) {
  return useQuery({
    queryKey: qk("accounts", "history", id, days),
    queryFn: () => api.get<{ date: string; balance: number }[]>(`/api/accounts/${id}/history`, { query: { days } }),
    enabled: !!id,
  });
}

export function useCardStatement(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk("accounts", "statement", id),
    queryFn: () => api.get<CardStatement>(`/api/accounts/${id}/statement`),
    enabled: !!id && enabled,
  });
}

export function useMonthlyReview(periodStart?: string) {
  return useQuery({
    queryKey: qk("analytics", "review", periodStart ?? "last"),
    queryFn: () => api.get<MonthlyReview>("/api/review", { query: { periodStart } }),
    placeholderData: keepPreviousData,
  });
}

export function useBudgetTemplates() {
  return useQuery({ queryKey: qk("budgets", "templates"), queryFn: () => api.get<BudgetTemplateDTO[]>("/api/budgets/templates") });
}

export function useGoalContributions(goalId: string | null | undefined) {
  return useQuery({
    queryKey: qk("goals", "contributions", goalId),
    queryFn: () => api.get<ContributionDTO[]>(`/api/goals/${goalId}/contributions`),
    enabled: !!goalId,
  });
}

/** Generic GET hook for simple read endpoints keyed under a domain. */
export function useApiGet<T>(domain: Parameters<typeof qk>[0], path: string, query?: Record<string, string | number | boolean | undefined>, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk(domain, path, query ?? {}),
    queryFn: ({ signal }) => api.get<T>(path, { query, signal }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}
