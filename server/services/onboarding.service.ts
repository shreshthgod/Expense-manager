import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { financialMonthOf, toDbDate } from "@/lib/dates/date-only";
import type { OnboardingStepInput } from "@/lib/validation/schemas";
import type { TxClient } from "@/server/db/idempotency";
import { auditTx } from "@/server/services/audit.service";
import { ensureSystemCategories } from "@/server/services/category.service";
import { createAccount, toAccountDTO } from "@/server/services/account.service";
import { createBudget } from "@/server/services/budget.service";
import { createGoal } from "@/server/services/goal.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const ONBOARDING_STEPS = ["preferences", "income", "account", "categories", "budget", "goal", "complete"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  completedSteps: OnboardingStep[];
  accountId?: string | null;
  accountSkipped?: boolean;
  budgetId?: string | null;
  goalId?: string | null;
}

function readState(raw: unknown): OnboardingState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<OnboardingState>;
  return {
    completedSteps: Array.isArray(s.completedSteps)
      ? (s.completedSteps as unknown[]).filter((x): x is OnboardingStep => ONBOARDING_STEPS.includes(x as OnboardingStep))
      : [],
    accountId: s.accountId ?? null,
    accountSkipped: s.accountSkipped ?? false,
    budgetId: s.budgetId ?? null,
    goalId: s.goalId ?? null,
  };
}

export function nextStep(state: OnboardingState): OnboardingStep {
  return ONBOARDING_STEPS.find((s) => !state.completedSteps.includes(s)) ?? "complete";
}

export async function getOnboarding(userId: string) {
  await ensureSystemCategories(userId);
  const [user, profile, pref] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { onboardedAt: true, name: true } }),
    prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } }),
    prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } }),
  ]);
  const state = readState(profile.onboardingState);
  const account = state.accountId ? await prisma.account.findFirst({ where: { id: state.accountId, userId } }) : null;
  const budget = state.budgetId ? await prisma.budget.findFirst({ where: { id: state.budgetId, userId } }) : null;
  const goal = state.goalId ? await prisma.savingsGoal.findFirst({ where: { id: state.goalId, userId } }) : null;
  return {
    name: user?.name ?? "",
    onboarded: user?.onboardedAt != null,
    state,
    nextStep: nextStep(state),
    values: {
      currency: pref.currency,
      dateFormat: pref.dateFormat,
      timezone: profile.timezone,
      monthStartDay: pref.monthStartDay,
      monthlyIncome: profile.monthlyIncome != null ? Number(profile.monthlyIncome) : null,
      occupation: profile.occupation,
      account: account ? toAccountDTO(account) : null,
      budget: budget ? { id: budget.id, name: budget.name, amount: Number(budget.amount), categoryId: budget.categoryId } : null,
      goal: goal ? { id: goal.id, name: goal.name, targetAmount: Number(goal.targetAmount), deadline: goal.deadline?.toISOString().slice(0, 10) ?? null } : null,
    },
  };
}

async function saveState(tx: TxClient, userId: string, state: OnboardingState, step: OnboardingStep) {
  const completed = state.completedSteps.includes(step) ? state.completedSteps : [...state.completedSteps, step];
  await tx.profile.update({
    where: { userId },
    data: { onboardingState: { ...state, completedSteps: completed } as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Applies one onboarding step. Every step is idempotent: re-submitting (refresh,
 * retry, Back → Next) updates what the step created earlier instead of creating
 * duplicates — accounts, budgets and goals are tracked by id in the state.
 */
export async function applyOnboardingStep(userId: string, input: OnboardingStepInput) {
  await prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } });
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Profile" WHERE "userId" = ${userId} FOR UPDATE`;
      const profile = await tx.profile.findUniqueOrThrow({ where: { userId } });
      const state = readState(profile.onboardingState);

      switch (input.step) {
        case "preferences": {
          const hasAccounts = (await tx.account.count({ where: { userId } })) > 0;
          const pref = await tx.userPreference.findUniqueOrThrow({ where: { userId } });
          if (hasAccounts && pref.currency !== input.currency) {
            throw ApiError.field("currency", "Currency can't change after accounts are created.");
          }
          await tx.userPreference.update({
            where: { userId },
            data: { currency: input.currency, ...(input.dateFormat ? { dateFormat: input.dateFormat } : {}) },
          });
          await tx.profile.update({ where: { userId }, data: { timezone: input.timezone } });
          break;
        }
        case "income": {
          await tx.profile.update({
            where: { userId },
            data: {
              monthlyIncome: input.monthlyIncome != null ? new Prisma.Decimal(input.monthlyIncome.toFixed(2)) : null,
              ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
            },
          });
          if (input.monthStartDay) {
            await tx.userPreference.update({ where: { userId }, data: { monthStartDay: input.monthStartDay } });
          }
          break;
        }
        case "account": {
          if (input.skip) {
            state.accountSkipped = true;
            break;
          }
          const existing = state.accountId ? await tx.account.findFirst({ where: { id: state.accountId, userId } }) : null;
          if (existing) {
            const used = await tx.transaction.count({
              where: { userId, deletedAt: null, OR: [{ accountId: existing.id }, { destinationAccountId: existing.id }] },
            });
            const opening = input.openingBalance ?? 0;
            await tx.account.update({
              where: { id: existing.id },
              data: {
                name: input.name!,
                type: input.type!,
                institution: input.institution ?? null,
                ...(used === 0
                  ? {
                      openingBalance: new Prisma.Decimal(opening.toFixed(2)),
                      balance: new Prisma.Decimal(opening.toFixed(2)),
                      openingDate: toDbDate(input.openingDate ?? today),
                    }
                  : {}),
                version: { increment: 1 },
              },
            });
          } else {
            const { account } = await createAccount(
              userId,
              {
                name: input.name!,
                type: input.type!,
                openingBalance: input.openingBalance ?? 0,
                openingDate: input.openingDate ?? today,
                institution: input.institution ?? null,
                includeInNetWorth: true,
              },
              { client: tx }
            );
            state.accountId = account.id;
            state.accountSkipped = false;
            await tx.userPreference.update({ where: { userId }, data: { defaultAccountId: account.id } });
          }
          break;
        }
        case "categories": {
          const keep = new Set(input.keepCategoryIds);
          const system = await tx.category.findMany({ where: { userId, isSystem: true } });
          for (const c of system) {
            const shouldArchive = !keep.has(c.id);
            if (shouldArchive !== (c.archivedAt != null)) {
              await tx.category.update({ where: { id: c.id }, data: { archivedAt: shouldArchive ? new Date() : null } });
            }
          }
          for (const custom of input.customCategories) {
            const clash = await tx.category.findFirst({ where: { userId, name: { equals: custom.name, mode: "insensitive" } } });
            if (!clash) {
              await tx.category.create({ data: { userId, name: custom.name, type: custom.type, isSystem: false, color: "#64748b" } });
            }
          }
          break;
        }
        case "budget": {
          if (input.skip) break;
          const month = financialMonthOf(today, settings.monthStartDay);
          const existing = state.budgetId ? await tx.budget.findFirst({ where: { id: state.budgetId, userId } }) : null;
          if (existing) {
            await tx.budget.update({
              where: { id: existing.id },
              data: {
                name: input.name!,
                amount: new Prisma.Decimal(input.amount!.toFixed(2)),
                categoryId: input.categoryId ?? null,
                version: { increment: 1 },
              },
            });
          } else {
            const created = (await createBudget(
              userId,
              { name: input.name!, amount: input.amount!, period: "MONTHLY", startDate: month.start, endDate: null, categoryId: input.categoryId ?? null, rolloverMode: "NONE" },
              { client: tx }
            )) as { id: string };
            state.budgetId = created.id;
          }
          break;
        }
        case "goal": {
          if (input.skip) break;
          const existing = state.goalId ? await tx.savingsGoal.findFirst({ where: { id: state.goalId, userId } }) : null;
          if (existing) {
            await tx.savingsGoal.update({
              where: { id: existing.id },
              data: {
                name: input.name!,
                targetAmount: new Prisma.Decimal(input.targetAmount!.toFixed(2)),
                deadline: input.deadline ? toDbDate(input.deadline) : null,
                version: { increment: 1 },
              },
            });
          } else {
            const created = (await createGoal(
              userId,
              { name: input.name!, targetAmount: input.targetAmount!, currentAmount: 0, deadline: input.deadline ?? null, kind: "SAVINGS", repeatsYearly: false },
              { client: tx }
            )) as { id: string };
            state.goalId = created.id;
          }
          break;
        }
        case "complete": {
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardedAt: true } });
          if (!user.onboardedAt) {
            await tx.user.update({ where: { id: userId }, data: { onboardedAt: new Date() } });
            await auditTx(tx, { userId, action: "ONBOARDING_COMPLETED", entity: "User", entityId: userId });
          }
          break;
        }
      }
      await saveState(tx, userId, state, input.step);
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
  return getOnboarding(userId);
}
