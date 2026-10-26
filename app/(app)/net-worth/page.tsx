"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader, Refreshing } from "@/components/app/states";
import { Explain, Segmented, StatTile } from "@/components/app/kit";
import { TimeSeries } from "@/components/charts/charts";
import { useFormat } from "@/components/providers/app-context";
import { useNetWorth } from "@/lib/client/hooks";
import { accountTypeMeta } from "@/lib/constants";
import type { AccountType } from "@/types";

export default function NetWorthPage() {
  const [months, setMonths] = React.useState("12");
  const q = useNetWorth(Number(months));
  const f = useFormat();
  return (
    <>
      <PageHeader
        title="Net worth"
        description="What you own minus what you owe, month by month — rebuilt from your ledger, so back-dated entries are reflected."
        actions={
          <>
            <Refreshing active={q.isFetching && !q.isLoading} />
            <Segmented label="Range" value={months} onChange={setMonths} options={[{ value: "6", label: "6 months" }, { value: "12", label: "1 year" }, { value: "24", label: "2 years" }]} />
          </>
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Net worth today" value={f.money(q.data.summary.netWorth)} emphasis />
            <StatTile label={`Change over ${months} months`} value={`${q.data.change >= 0 ? "+" : "−"}${f.money(Math.abs(q.data.change))}`} />
            <StatTile label="Assets" value={f.money(q.data.summary.totalAssets)} />
            <StatTile label="Liabilities" value={f.money(q.data.summary.totalLiabilities)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Month-end net worth</CardTitle>
              <CardDescription>The current month shows today's figure.</CardDescription>
            </CardHeader>
            <CardContent>
              <TimeSeries
                label={`Net worth by month: ${q.data.points.map((p) => `${p.date} ${f.money(p.netWorth)}`).join(", ")}`}
                data={q.data.points.map((p) => ({ label: f.dateShort(p.date), netWorth: p.netWorth, assets: p.assets, liabilities: p.liabilities }))}
                series={[
                  { key: "netWorth", name: "Net worth", color: "hsl(var(--chart-1))" },
                  { key: "assets", name: "Assets", color: "hsl(var(--inflow))", dashed: true },
                  { key: "liabilities", name: "Liabilities", color: "hsl(var(--outflow))", dashed: true },
                ]}
                area={false}
                height={280}
              />
              <Explain className="mt-3">
                Each point = Σ (opening balance + posted transactions up to that date) for accounts included in net worth that were open on that date. Liabilities count as negative.
                Planned transactions and credit limits are never counted.
              </Explain>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>By account</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <caption className="sr-only">Balances by account</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Account</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 text-right font-medium">Balance</th></tr>
                </thead>
                <tbody className="divide-y">
                  {q.data.accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2"><Link href={`/accounts/${a.id}`} className="hover:underline">{a.name}</Link>{a.archived ? <span className="text-xs text-muted-foreground"> (archived)</span> : null}</td>
                      <td className="py-2 text-muted-foreground">{accountTypeMeta(a.type as AccountType).label}</td>
                      <td className={`py-2 text-right num ${a.balance < 0 ? "text-outflow" : ""}`}>{f.money(a.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            History is recalculated from transactions; saved month-end snapshots appear in <Link href="/review" className="text-primary hover:underline">Monthly review</Link>.
          </p>
        </div>
      )}
    </>
  );
}
