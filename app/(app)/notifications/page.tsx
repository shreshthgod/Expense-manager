"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Segmented } from "@/components/app/kit";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useNotifications } from "@/lib/client/hooks";
import { cn } from "@/lib/utils/cn";

export default function NotificationsPage() {
  const f = useFormat();
  const { addToast } = useToast();
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const [page, setPage] = React.useState(1);
  const q = useNotifications({ page, pageSize: 20, unreadOnly: filter === "unread" });
  const markAll = useFinanceMutation({
    affects: ["notification"],
    mutationFn: () => api.patch("/api/notifications"),
    onSuccess: (res) => addToast(res.message ?? "All marked as read", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  const setRead = useFinanceMutation({
    affects: ["notification"],
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api.patch(`/api/notifications/${id}`, { read }),
    onError: (e) => addToast(e.message, "error"),
  });
  const remove = useFinanceMutation({
    affects: ["notification"],
    mutationFn: (id: string) => api.delete(`/api/notifications/${id}`),
    onError: (e) => addToast(e.message, "error"),
  });
  const data = q.data;
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Budget alerts, bill reminders, goal milestones and unusual expenses."
        actions={
          <>
            <Button asChild variant="ghost" size="sm"><Link href="/settings?tab=notifications"><Settings aria-hidden="true" /> Preferences</Link></Button>
            <Button variant="outline" size="sm" onClick={() => markAll.mutate(undefined)} loading={markAll.isPending} disabled={!data?.unreadCount}>
              <CheckCheck aria-hidden="true" /> Mark all read
            </Button>
          </>
        }
      />
      <Segmented label="Show" value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread${data ? ` (${data.unreadCount})` : ""}` }]} className="mb-4" />
      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : data!.items.length === 0 ? (
        <EmptyState icon={Bell} title={filter === "unread" ? "You're all caught up" : "No notifications yet"} description="You'll be told when a budget passes 50/75/90/100%, a bill is due, a goal reaches a milestone or an expense looks unusual." />
      ) : (
        <Card className="divide-y overflow-hidden">
          {data!.items.map((n) => (
            <div key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.read && "bg-primary-soft/40")}>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</p>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.timeAgo(n.createdAt)}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {n.link && (
                    <Button asChild size="xs" variant="outline">
                      <Link href={n.link} onClick={() => !n.read && setRead.mutate({ id: n.id, read: true })}>Open</Link>
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => setRead.mutate({ id: n.id, read: !n.read })}>{n.read ? "Mark unread" : "Mark read"}</Button>
                </div>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate(n.id)} aria-label={`Delete notification: ${n.title}`}><Trash2 aria-hidden="true" /></Button>
            </div>
          ))}
        </Card>
      )}
      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {data.totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}
