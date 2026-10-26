"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { ApiClientError } from "@/lib/client/api";

/**
 * Client cache + dependency-driven invalidation.
 *
 * Every query key starts with ["u", userId, domain, ...] so one user's data
 * can never be served to another after a user switch, and a whole domain can
 * be invalidated at once. Mutations declare WHAT they changed (a MutationKind);
 * DEPENDENCIES maps that to every view that must refresh — forms never keep
 * their own refresh lists (spec §169 dependency matrix).
 */

export type Domain =
  | "dashboard"
  | "transactions"
  | "accounts"
  | "categories"
  | "budgets"
  | "goals"
  | "recurring"
  | "schedule"
  | "analytics"
  | "reports"
  | "insights"
  | "notifications"
  | "tags"
  | "merchants"
  | "preferences"
  | "profile"
  | "sessions"
  | "conversations"
  | "onboarding"
  | "inbox"
  | "imports"
  | "rules";

export type MutationKind =
  | "transaction"
  | "account"
  | "category"
  | "budget"
  | "goal"
  | "recurring"
  | "notification"
  | "preferences"
  | "profile"
  | "session"
  | "report"
  | "conversation"
  | "onboarding"
  | "import"
  | "rule";

const MONEY_VIEWS: Domain[] = [
  "dashboard",
  "transactions",
  "accounts",
  "budgets",
  "analytics",
  "reports",
  "insights",
  "schedule",
  "recurring",
  "notifications",
  "merchants",
  "tags",
  "inbox",
];

export const DEPENDENCIES: Record<MutationKind, Domain[]> = {
  // Any money movement: balances, both periods, budgets, analytics, stale reports, calendar.
  transaction: MONEY_VIEWS,
  account: ["accounts", "dashboard", "transactions", "analytics", "insights", "recurring", "schedule", "preferences"],
  // Labels/classification only — but every aggregate grouped by category changes.
  category: ["categories", "transactions", "budgets", "analytics", "dashboard", "insights", "recurring", "reports", "inbox"],
  budget: ["budgets", "dashboard", "insights", "analytics", "notifications"],
  goal: ["goals", "dashboard", "insights", "notifications"],
  // Future obligations + anything a settle may have posted.
  recurring: [...MONEY_VIEWS, "recurring", "schedule"],
  notification: ["notifications", "dashboard"],
  // Formatting, periods and notification policy affect nearly every screen.
  preferences: ["preferences", "dashboard", "analytics", "budgets", "insights", "reports", "transactions", "accounts", "schedule"],
  profile: ["profile"],
  session: ["sessions"],
  report: ["reports", "notifications"],
  conversation: ["conversations"],
  onboarding: ["onboarding", "accounts", "categories", "budgets", "goals", "dashboard", "preferences", "profile"],
  import: [...MONEY_VIEWS, "imports", "categories"],
  rule: ["rules", "transactions", "inbox"],
};

let currentUserId = "anonymous";

export function setQueryUser(userId: string) {
  currentUserId = userId;
}

/** Key factory: always user-scoped. */
export function qk(domain: Domain, ...rest: unknown[]): unknown[] {
  return ["u", currentUserId, domain, ...rest];
}

const CHANNEL = "em-data-sync";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, error) => {
          if (error instanceof ApiClientError) {
            return ["network", "timeout", "unavailable", "server"].includes(error.kind) && count < 2;
          }
          return count < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

const BroadcastContext = React.createContext<((domains: Domain[]) => void) | null>(null);

export function QueryProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [client] = React.useState(makeClient);
  setQueryUser(userId);

  const channelRef = React.useRef<BroadcastChannel | null>(null);

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ userId: string; domains?: Domain[]; logout?: boolean }>) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.logout) {
        client.clear();
        window.location.assign("/login");
        return;
      }
      // Another tab of the same user changed data: revalidate (never re-mutate).
      if (msg.userId === userId && msg.domains) {
        for (const d of msg.domains) void client.invalidateQueries({ queryKey: ["u", userId, d] });
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [client, userId]);

  // A different user must never see the previous user's cached data.
  const previousUser = React.useRef(userId);
  React.useEffect(() => {
    if (previousUser.current !== userId) {
      client.clear();
      previousUser.current = userId;
    }
  }, [client, userId]);

  const broadcast = React.useCallback(
    (domains: Domain[]) => channelRef.current?.postMessage({ userId, domains }),
    [userId]
  );

  return (
    <QueryClientProvider client={client}>
      <BroadcastContext.Provider value={broadcast}>{children}</BroadcastContext.Provider>
    </QueryClientProvider>
  );
}

/** Invalidate everything a mutation kind affects (this tab + other tabs). */
export function useInvalidate() {
  const client = useQueryClient();
  const broadcast = React.useContext(BroadcastContext);
  return React.useCallback(
    async (...kinds: MutationKind[]) => {
      const domains = [...new Set(kinds.flatMap((k) => DEPENDENCIES[k]))];
      broadcast?.(domains);
      await Promise.all(domains.map((d) => client.invalidateQueries({ queryKey: ["u", currentUserId, d] })));
    },
    [client, broadcast]
  );
}

/** Clears private cached data (logout, account deletion) in every tab. */
export function useClearAllData() {
  const client = useQueryClient();
  return React.useCallback(() => {
    client.clear();
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage({ logout: true });
      channel.close();
    }
    try {
      window.localStorage.removeItem("em-cache");
      navigator.serviceWorker?.controller?.postMessage("clear");
    } catch {
      /* storage unavailable */
    }
  }, [client]);
}

/**
 * useMutation + automatic dependency invalidation after a COMMITTED success.
 * Correctness over speed: financial writes are not optimistic.
 */
export function useFinanceMutation<TData, TVariables>(
  options: UseMutationOptions<TData, ApiClientError, TVariables> & { affects: MutationKind[] }
) {
  const invalidate = useInvalidate();
  const { affects, onSuccess, ...rest } = options;
  return useMutation<TData, ApiClientError, TVariables>({
    ...rest,
    onSuccess: async (...args) => {
      await invalidate(...affects);
      await onSuccess?.(...args);
    },
  });
}
