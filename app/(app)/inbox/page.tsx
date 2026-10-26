"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCheck, CircleDollarSign, FileUp, Flag, Inbox, LineChart, PieChart, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Refreshing } from "@/components/app/states";
import { useFormat } from "@/components/providers/app-context";
import { useInbox } from "@/lib/client/hooks";
import type { InboxKind } from "@/server/services/inbox.service";

const ICON: Record<InboxKind, React.ElementType> = {
  uncategorized: Tags,
  planned_past: CalendarClock,
  bill_due: CircleDollarSign,
  bill_failed: AlertTriangle,
  budget_over: PieChart,
  goal_behind: Flag,
  reconcile: CheckCheck,
  month_review: LineChart,
  import_pending: FileUp,
};

export default function InboxPage() {
  const q = useInbox();
  const f = useFormat();
  return (
    <>
      <PageHeader
        title="Review inbox"
        description="Things that need a decision. Each item disappears as soon as the underlying issue is resolved."
        actions={<Refreshing active={q.isFetching && !q.isLoading} />}
      />
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <EmptyState icon={Inbox} title="All clear" description="Nothing needs your attention right now." action={<Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>} />
      ) : (
        <Card className="divide-y overflow-hidden">
          {q.data!.items.map((i) => {
            const Icon = ICON[i.kind];
            return (
              <div key={i.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${i.priority === 1 ? "bg-outflow-soft text-outflow" : i.priority === 2 ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary"}`} aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {i.title}
                    {i.priority === 1 && <Badge variant="outflow">Needs action</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">{i.detail}</p>
                </div>
                {i.amount != null && i.amount > 0 && <span className="font-medium num">{f.money(i.amount)}</span>}
                <Button asChild size="sm" variant={i.priority === 1 ? "default" : "outline"}>
                  <Link href={i.href}>{i.action} <ArrowRight aria-hidden="true" /></Link>
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
