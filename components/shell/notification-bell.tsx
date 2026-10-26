"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useNotifications } from "@/lib/client/hooks";
import { cn } from "@/lib/utils/cn";
import { DURATION, EASE } from "@/lib/motion/tokens";
import type { NotificationDTO } from "@/server/services/notification.service";

export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const f = useFormat();
  const { data } = useNotifications({ pageSize: 10 });
  const unread = data?.unreadCount ?? 0;

  const markRead = useFinanceMutation<unknown, string>({
    affects: ["notification"],
    mutationFn: (id) => api.patch(`/api/notifications/${id}`, { read: true }),
  });
  const markAll = useFinanceMutation<unknown, void>({
    affects: ["notification"],
    mutationFn: () => api.patch("/api/notifications", {}),
  });

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openItem = (n: NotificationDTO) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const rect = open ? buttonRef.current?.getBoundingClientRect() : undefined;

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative"
      >
        <Bell aria-hidden="true" />
        {unread > 0 && (
          <span className="num absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-outflow px-1 text-[10px] font-semibold text-white" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && rect && (
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-label="Recent notifications"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: DURATION.disclosure, ease: EASE.out } }}
                exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
                style={{ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) }}
                className="fixed z-[60] w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
              >
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">Notifications</h2>
                  <button
                    type="button"
                    disabled={unread === 0 || markAll.isPending}
                    onClick={() => markAll.mutate()}
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
                  </button>
                </div>
                <ul className="max-h-[22rem] overflow-y-auto scrollbar-thin">
                  {(data?.items ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</li>}
                  {(data?.items ?? []).map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                          !n.read && "bg-primary-soft/40"
                        )}
                      >
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug">{n.title}</span>
                          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{n.message}</span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">{f.timeAgo(n.createdAt)}</span>
                        </span>
                        {!n.read && <span className="sr-only">Unread</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-accent">
                  View all notifications
                </Link>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
