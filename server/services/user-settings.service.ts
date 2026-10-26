import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayISO, type ISODate } from "@/lib/dates/date-only";

/** Settings that change how financial periods are computed and displayed. */
export interface UserSettings {
  timezone: string;
  weekStartsOn: number;
  monthStartDay: number;
  currency: string;
  dateFormat: string;
  emergencyFundMonths: number;
  defaultAccountId: string | null;
  monthlyIncome: number | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  timezone: DEFAULT_TIME_ZONE,
  weekStartsOn: 1,
  monthStartDay: 1,
  currency: "INR",
  dateFormat: "DD MMM YYYY",
  emergencyFundMonths: 6,
  defaultAccountId: null,
  monthlyIncome: null,
};

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const [pref, profile] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.profile.findUnique({ where: { userId }, select: { timezone: true, monthlyIncome: true } }),
  ]);
  const timezone = profile?.timezone && isValidTimeZone(profile.timezone) ? profile.timezone : DEFAULT_TIME_ZONE;
  return {
    timezone,
    weekStartsOn: pref?.weekStartsOn ?? DEFAULT_SETTINGS.weekStartsOn,
    monthStartDay: pref?.monthStartDay ?? DEFAULT_SETTINGS.monthStartDay,
    currency: pref?.currency ?? DEFAULT_SETTINGS.currency,
    dateFormat: pref?.dateFormat ?? DEFAULT_SETTINGS.dateFormat,
    emergencyFundMonths: pref?.emergencyFundMonths ?? DEFAULT_SETTINGS.emergencyFundMonths,
    defaultAccountId: pref?.defaultAccountId ?? null,
    monthlyIncome: profile?.monthlyIncome != null ? Number(profile.monthlyIncome) : null,
  };
}

export function todayFor(settings: Pick<UserSettings, "timezone">, now: Date = new Date()): ISODate {
  return todayISO(settings.timezone, now);
}
