"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app/states";
import { Delta, Segmented, Swatch } from "@/components/app/kit";
import { TransactionExplorer } from "@/components/transactions/transaction-list";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { useFormat } from "@/components/providers/app-context";
import { useApiGet, useRecurring } from "@/lib/client/hooks";
import type { CategoryAnalysis } from "@/server/analytics/categories";

function Sources() {
  const f = useFormat();
  const [preset, setPreset] = React.useState("this_month");
  const q = useApiGet<{ period: { label: string }; items: CategoryAnalysis[] }>("analytics", "/api/analytics/categories", { preset, kind: "INCOME" });
  const recurring = useRecurring();
  const expected = (recurring.data ?? []).filter((r) => r.type === "INCOME" && r.active && !r.cancelled);
  const total = (q.data?.items ?? []).reduce((s, i) => s + i.total, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Income by source</CardTitle>
            <CardDescription>{q.data?.period.label ?? "…"}</CardDescription>
          </div>
          <Segmented label="Period" size="xs" value={preset} onChange={setPreset} options={[{ value: "this_month", label: "Month" }, { value: "last_month", label: "Last month" }, { value: "this_year", label: "Year" }]} />
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-24" />
          ) : (q.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No income recorded in this period.</p>
          ) : (
            <>
              <p className="mb-3 text-2xl font-semibold text-inflow num">{f.money(total)}</p>
              <ul className="space-y-2">
                {q.data!.items.map((i) => (
                  <li key={i.categoryId ?? "none"} className="flex items-center gap-2 text-sm">
                    <Swatch color={i.color} />
                    <span className="flex-1 truncate">{i.name}</span>
                    <Delta value={i.changePct} goodWhen="up" suffix="" />
                    <span className="w-28 text-right font-medium num">{f.money(i.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Expected income</CardTitle>
            <CardDescription>Recurring income you've set up</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm"><Link href="/recurring?type=INCOME"><Repeat aria-hidden="true" /> Manage</Link></Button>
        </CardHeader>
        <CardContent>
          {recurring.isLoading ? (
            <Skeleton className="h-24" />
          ) : expected.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add your salary as recurring income to see it in the calendar and cash-flow forecast. <Link className="text-primary underline" href="/recurring?new=INCOME">Set it up</Link>
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {expected.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.nextDueDate ? `Next ${f.relative(r.nextDueDate)}` : "No upcoming date"} · {r.accountName}</span>
                  </span>
                  <span className="font-medium text-inflow num">{f.money(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function IncomePage() {
  const tx = useTransactionDialog();
  return (
    <>
      <PageHeader
        title="Income"
        description="Money you've earned. Transfers between your own accounts and refunds are not income."
        actions={<Button onClick={() => tx.openCreate({ type: "INCOME" }, { lockType: true })}><Plus aria-hidden="true" /> Add income</Button>}
      />
      <div className="space-y-6">
        <Sources />
        <React.Suspense>
          <TransactionExplorer fixed={{ type: "INCOME" }} emptyTitle="No income recorded yet" emptyAction={<Button onClick={() => tx.openCreate({ type: "INCOME" }, { lockType: true })}>Add income</Button>} />
        </React.Suspense>
      </div>
    </>
  );
}
