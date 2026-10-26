"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { LogOut, Menu, Monitor, Moon, MoreHorizontal, Plus, Search, Sun, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/providers/app-context";
import { TransactionDialogProvider, useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { NotificationBell } from "@/components/shell/notification-bell";
import { CommandPalette, useCommandPalette } from "@/components/shell/command-palette";
import { api } from "@/lib/client/api";
import { useClearAllData, useInvalidate } from "@/lib/client/query";
import { ALL_NAV, FOOTER_NAV, NAV_GROUPS, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils/cn";
import { overlayVariants } from "@/lib/motion/tokens";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-primary-soft"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          aria-hidden="true"
        />
      )}
      <item.icon className={cn("relative h-[18px] w-[18px] shrink-0", active && "text-primary")} aria-hidden="true" />
      <span className="relative">{item.label}</span>
    </Link>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 scrollbar-thin">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground/80">{group.label}</p>
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      <div className="mt-auto space-y-0.5 border-t pt-3">
        {FOOTER_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M5 7h14M5 12h10M5 17h6" />
        </svg>
      </span>
      <span className="text-[0.95rem] font-semibold tracking-tight">Expense Manager</span>
    </Link>
  );
}

function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  const items = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      {items.map((i) => (
        <DropdownMenuItem key={i.value} onSelect={() => setTheme(i.value)}>
          <i.icon aria-hidden="true" />
          {i.label}
          {theme === i.value && <span className="ml-auto text-xs text-primary">Current</span>}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function UserMenu() {
  const user = useUser();
  const router = useRouter();
  const clearAll = useClearAllData();
  const { addToast } = useToast();
  const signOut = async () => {
    try {
      await api.post("/api/auth/logout", {}, { noAuthRedirect: true });
    } catch {
      /* session already gone — still clear local data */
    }
    clearAll();
    addToast("Signed out", "info");
    router.replace("/login");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
        <Avatar name={user.name} src={user.avatarUrl} className="h-8 w-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings?tab=security")}>Security & sessions</DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OfflineBanner() {
  const [offline, setOffline] = React.useState(false);
  const client = useQueryClient();
  React.useEffect(() => {
    const update = () => {
      const now = !navigator.onLine;
      setOffline(now);
      if (!now) void client.invalidateQueries();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [client]);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm">
      <WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>You're offline. You're seeing the last loaded figures, which may be out of date. Changes can't be saved until you reconnect.</span>
    </div>
  );
}

/** Catch up scheduled work (due bills, recurring entries, reminders) for this user. */
function useBackgroundSync() {
  const invalidate = useInvalidate();
  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await api.post<{ skipped: boolean; recurring?: { transactionsCreated: number; occurrencesDue: number } }>(
          "/api/system/sync",
          {},
          { noAuthRedirect: true }
        );
        const r = res.data.recurring;
        if (!cancelled && r && (r.transactionsCreated > 0 || r.occurrencesDue > 0)) await invalidate("recurring");
      } catch {
        /* non-critical: the cron endpoint also runs this */
      }
    };
    void run();
    const interval = setInterval(run, 15 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [invalidate]);
}

function MobileNav({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const tx = useTransactionDialog();
  const items = ALL_NAV.filter((i) => i.mobile);
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur-sm safe-bottom lg:hidden">
      <ul className="grid h-16 grid-cols-5">
        {items.slice(0, 2).map((item) => (
          <MobileNavItem key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
        <li className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => tx.openCreate()}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Add a transaction"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </button>
        </li>
        {items.slice(2, 3).map((item) => (
          <MobileNavItem key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
        <li>
          <button
            type="button"
            onClick={onMore}
            className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

function MobileNavItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active ? "text-primary" : "text-muted-foreground"
        )}
      >
        <item.icon className="h-5 w-5" aria-hidden="true" />
        {item.label === "Transactions" ? "Activity" : item.label}
      </Link>
    </li>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const tx = useTransactionDialog();
  const palette = useCommandPalette();
  useBackgroundSync();

  React.useEffect(() => setDrawerOpen(false), [pathname]);
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only-focusable fixed left-2 top-2 z-[70] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Brand />
        </div>
        <SidebarNav pathname={pathname} />
      </aside>

      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <motion.div className="absolute inset-0 bg-foreground/40" variants={overlayVariants} initial="hidden" animate="visible" exit="exit" onClick={() => setDrawerOpen(false)} />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ x: "-100%", transition: { duration: 0.18 } }}
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl safe-top"
            >
              <div className="flex h-16 items-center justify-between px-5">
                <Brand />
                <Button variant="ghost" size="icon-sm" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
                  <X aria-hidden="true" />
                </Button>
              </div>
              <SidebarNav pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur-sm safe-top sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </Button>
          <button
            type="button"
            onClick={palette.open}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Search or jump to…</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[11px] font-medium sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" onClick={() => tx.openCreate()} className="hidden sm:inline-flex">
              <Plus aria-hidden="true" /> Add
            </Button>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <OfflineBanner />
        <main id="main" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>

      <MobileNav pathname={pathname} onMore={() => setDrawerOpen(true)} />
      <CommandPalette />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div id="app-root">
      <TransactionDialogProvider>
        <ShellInner>{children}</ShellInner>
      </TransactionDialogProvider>
    </div>
  );
}
