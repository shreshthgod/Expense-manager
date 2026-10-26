"use client";

import * as React from "react";
import { MotionConfig } from "framer-motion";
import { useTheme } from "next-themes";
import {
  formatInstant,
  formatISODate,
  formatISODateShort,
  formatMoney,
  formatPercent,
  formatRelativeISODate,
  formatSignedPercent,
  formatTimeAgo,
  type MoneyFormatOptions,
} from "@/lib/utils/format";
import { todayISO, type ISODate } from "@/lib/dates/date-only";
import { QueryProvider } from "@/lib/client/query";
import type { MotionPreference } from "@/lib/motion/tokens";
import { api } from "@/lib/client/api";

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  onboardedAt: string | null;
}

export interface ClientPreferences {
  currency: string;
  dateFormat: string;
  theme: "light" | "dark" | "system";
  motion: MotionPreference;
  timezone: string;
  weekStartsOn: number;
  monthStartDay: number;
  defaultAccountId: string | null;
}

interface AppContextValue {
  user: ClientUser;
  preferences: ClientPreferences;
  /** Apply saved preferences everywhere immediately (after a successful PATCH). */
  applyPreferences: (next: Partial<ClientPreferences>) => void;
}

const AppContext = React.createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProviders>");
  return ctx;
}

export const useUser = () => useApp().user;
export const usePreferences = () => useApp().preferences;

/** Formatting bound to the user's currency, date format and time zone. */
export function useFormat() {
  const { currency, dateFormat, timezone } = usePreferences();
  return React.useMemo(() => {
    const today = () => todayISO(timezone);
    return {
      currency,
      today,
      money: (value: number, opts?: MoneyFormatOptions) => formatMoney(value, currency, opts),
      date: (value: ISODate | null | undefined) => formatISODate(value, dateFormat),
      dateShort: (value: ISODate | null | undefined) => formatISODateShort(value),
      relative: (value: ISODate) => formatRelativeISODate(value, today(), dateFormat),
      instant: (value: string | Date, withTime = false) => formatInstant(value, { timeZone: timezone, format: dateFormat, withTime }),
      timeAgo: (value: string | Date) => formatTimeAgo(value),
      percent: (value: number | null | undefined, digits = 1) => formatPercent(value, digits),
      signedPercent: (value: number | null | undefined, digits = 1) => formatSignedPercent(value, digits),
    };
  }, [currency, dateFormat, timezone]);
}

/** Keeps next-themes in sync with the persisted preference, in both directions. */
function ThemeSync({ preference }: { preference: ClientPreferences["theme"] }) {
  const { theme, setTheme } = useTheme();
  const initial = React.useRef(true);
  React.useEffect(() => {
    if (initial.current) {
      initial.current = false;
      if (theme !== preference) setTheme(preference);
    }
  }, [theme, preference, setTheme]);
  React.useEffect(() => {
    if (!initial.current && theme && theme !== preference && ["light", "dark", "system"].includes(theme)) {
      const t = setTimeout(() => {
        void api.patch("/api/preferences", { theme }).catch(() => undefined);
      }, 400);
      return () => clearTimeout(t);
    }
  }, [theme, preference]);
  return null;
}

function useMotionPreference(pref: MotionPreference) {
  React.useEffect(() => {
    document.documentElement.dataset.motion = pref;
  }, [pref]);
  // "system" defers to the OS; "reduced" keeps opacity only; "off" removes motion.
  return pref === "system" ? "user" : "always";
}

export function AppProviders({
  user,
  preferences: initial,
  children,
}: {
  user: ClientUser;
  preferences: ClientPreferences;
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = React.useState(initial);
  const applyPreferences = React.useCallback((next: Partial<ClientPreferences>) => {
    setPreferences((p) => ({ ...p, ...next }));
  }, []);
  const reducedMotion = useMotionPreference(preferences.motion);
  const value = React.useMemo(() => ({ user, preferences, applyPreferences }), [user, preferences, applyPreferences]);
  return (
    <AppContext.Provider value={value}>
      <QueryProvider userId={user.id}>
        <MotionConfig reducedMotion={reducedMotion} transition={preferences.motion === "off" ? { duration: 0 } : undefined}>
          <ThemeSync preference={preferences.theme} />
          {children}
        </MotionConfig>
      </QueryProvider>
    </AppContext.Provider>
  );
}
