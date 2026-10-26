import type { CurrentUser } from "@/lib/auth/session";
import type { ClientPreferences, ClientUser } from "@/components/providers/app-context";
import { DEFAULT_TIME_ZONE } from "@/lib/dates/date-only";

/** Serialisable user + preferences handed from server layouts to the client providers. */
export function toClientContext(user: CurrentUser): { user: ClientUser; preferences: ClientPreferences } {
  const p = user.preference;
  const theme = p?.theme === "light" || p?.theme === "dark" ? p.theme : "system";
  const motion = p?.motion === "reduced" || p?.motion === "off" ? p.motion : "system";
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      onboardedAt: user.onboardedAt?.toISOString() ?? null,
    },
    preferences: {
      currency: p?.currency ?? "INR",
      dateFormat: p?.dateFormat ?? "DD MMM YYYY",
      theme,
      motion,
      timezone: user.profile?.timezone ?? DEFAULT_TIME_ZONE,
      weekStartsOn: p?.weekStartsOn ?? 1,
      monthStartDay: p?.monthStartDay ?? 1,
      defaultAccountId: p?.defaultAccountId ?? null,
    },
  };
}
