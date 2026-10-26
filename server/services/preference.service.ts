import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import type { preferenceUpdateSchema } from "@/lib/validation/schemas";
import { audit } from "@/server/services/audit.service";

export type PreferenceUpdate = z.infer<typeof preferenceUpdateSchema>;

export interface PreferencesDTO {
  currency: string;
  dateFormat: string;
  theme: string;
  motion: string;
  timezone: string;
  notifyBudget: boolean;
  notifyGoal: boolean;
  notifyAIInsight: boolean;
  notifyRecurring: boolean;
  notifyBills: boolean;
  notifyAnomalies: boolean;
  weekStartsOn: number;
  monthStartDay: number;
  defaultAccountId: string | null;
  emergencyFundMonths: number;
  dashboardLayout: unknown;
  /** Base currency can only change while no financial records exist. */
  currencyLocked: boolean;
}

export async function getPreferences(userId: string): Promise<PreferencesDTO> {
  const [pref, profile, records] = await Promise.all([
    prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } }),
    prisma.profile.upsert({ where: { userId }, update: {}, create: { userId }, select: { timezone: true } }),
    prisma.account.count({ where: { userId } }),
  ]);
  const { id: _id, userId: _u, ...rest } = pref;
  return { ...rest, timezone: profile.timezone, currencyLocked: records > 0 };
}

export async function updatePreferences(userId: string, input: PreferenceUpdate): Promise<PreferencesDTO> {
  const current = await prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } });

  if (input.currency && input.currency !== current.currency) {
    const records = await prisma.account.count({ where: { userId } });
    if (records > 0) {
      throw ApiError.validation([
        {
          path: ["currency"],
          message: `Your accounts are recorded in ${current.currency}. Changing the currency would relabel amounts without converting them, so it is locked once accounts exist.`,
        },
      ]);
    }
  }
  if (input.defaultAccountId) {
    const account = await prisma.account.findFirst({ where: { id: input.defaultAccountId, userId, archivedAt: null } });
    if (!account) throw ApiError.field("defaultAccountId", "Choose one of your active accounts");
  }

  const { timezone, dashboardLayout, ...prefFields } = input;
  await prisma.$transaction(async (tx) => {
    await tx.userPreference.update({
      where: { userId },
      data: {
        ...prefFields,
        ...(dashboardLayout !== undefined
          ? { dashboardLayout: dashboardLayout === null ? Prisma.DbNull : (dashboardLayout as Prisma.InputJsonValue) }
          : {}),
      },
    });
    if (timezone) {
      await tx.profile.upsert({ where: { userId }, update: { timezone }, create: { userId, timezone } });
    }
    // Keep account currency labels aligned with the (unlocked) base currency.
    if (input.currency && input.currency !== current.currency) {
      await tx.account.updateMany({ where: { userId }, data: { currency: input.currency } });
    }
  });
  await audit({ userId, action: "PREFERENCES_UPDATED", entity: "UserPreference", entityId: userId, metadata: { fields: Object.keys(input) } });
  return getPreferences(userId);
}
