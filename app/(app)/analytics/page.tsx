"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ErrorState, PageHeader, Refreshing } from "@/components/app/states";
import { Delta, Explain, Segmented, StatTile, Swatch } from "@/components/app/kit";
import { Donut, GroupedBars, Sparkline } from "@/components/charts/charts";
import { useFormat } from "@/components/providers/app-context";
import { useApiGet } from "@/lib/client/hooks";
import type { FinancialSummary } from "@/server/analytics/summary";
import type { CategoryAnalysis } from "@/server/analytics/categories";
import type { MerchantSpend } from "@/server/analytics/merchants";
import type { TrendPoint } from "@/server/analytics/trends";
import type { CategoryTrend, SpendingStructure } from "@/server/analytics/structure";

type Preset = "this_month" | "last_month" | "3_months" | "6_months" | "this_year";

function Split({ label, a, b, other, aLabel, bLabel }: { label: string; a: number; b: number; other: number; aLabel: string; bLabel: string }) {
  const f = useFormat();
  const total = a + b + other;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${aLabel} ${pct(a)}%, ${bLabel} ${pct(b)}%, unclassified ${pct(other)}%`}>
        <div className="bg-[hsl(var(--chart-1))]" style={{ width: `${pct(a)}%` }} />
        <div className="bg-[hsl(var(--chart-3))]" style={{ width: `${pct(b)}%` }} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div><dt className="flex items-center gap-1 text-muted-foreground"><Swatch color="hsl(var(--chart-1))" /> {aLabel}</dt><dd className="font-medium num">{f.money(a)}</dd></div>
        <div><dt className="flex items-center gap-1 text-muted-foreground"><Swatch color="hsl(var(--chart-3))" /> {bLabel}</dt><dd className="font-medium num">{f.money(b)}</dd></div>
        <div><dt className="text-muted-foreground">Not classified</dt><dd className="font-medium num">{f.money(other)}</dd></div>
      </dl>
    </div>
  );
}

export default function AnalyticsPage() {
  const f = useFormat();
  const [preset, setPreset] = React.useState<Preset>("this_month");
  const summary = useApiGet<FinancialSummary>("analytics", "/api/analytics/summary", { preset });
  const cats = useApiGet<{ items: CategoryAnalysis[] }>("analytics", "/api/analytics/categories", { preset });
  const merchants = useApiGet<{ items: MerchantSpend[] } | MerchantSpend[]>("analytics", "/api/analytics/merchants", { preset });
  const structure = useApiGet<{ current: SpendingStructure; previous: SpendingStructure; velocity: { perDay: number; previousPerDay: number; changePct: number | null; projected: number; elapsedDays: number; periodDays: number } }>(
    "analytics",
    "/api/analytics/structure",
    { preset }
  );
  const trend = useApiGet<TrendPoint[]>("analytics", "/api/analytics/trends", { granularity: "month", months: 12 });
  const catTrends = useApiGet<{ months: { key: string }[]; items: CategoryTrend[] }>("analytics", "/api/analytics/category-trends", { months: 6, limit: 8 });
  const heat = useApiGet<{ weekdays: { weekday: number; average: number }[]; noSpendDays: number; days: unknown[] }>("analytics", "/api/analytics/heatmap", { preset });
  const merchantItems = Array.isArray(merchants.data) ? merchants.data : merchants.data?.items ?? [];
  const s = summary.data;
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Where your money goes, how it's changing and what kind of spending it is. Every figure uses net spending (expenses minus refunds)."
        actions={
          <>
            <Refreshing active={summary.isFetching && !summary.isLoading} />
            <Segmented
              label="Period"
              value={preset}
              onChange={setPreset}
              options={[
                { value: "this_month", label: "This month" },
                { value: "last_month", label: "Last month" },
                { value: "3_months", label: "3 months" },
                { value: "6_months", label: "6 months" },
                { value: "this_year", label: "Year" },
              ]}
            />
          </>
        }
      />
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {s ? (
              <>
                <StatTile label="Money in" value={f.money(s.current.income)} hint={<Delta value={s.changes.incomePct} goodWhen="up" />} />
                <StatTile label="Spent (net)" value={f.money(s.current.netSpending)} hint={<Delta value={s.changes.netSpendingPct} goodWhen="down" />} />
                <StatTile label="Kept" value={f.money(s.current.surplus)} hint={s.current.savingsRate == null ? "No income in period" : `${s.current.savingsRate}% savings rate`} />
                <StatTile
                  label="Spending pace"
                  value={structure.data ? `${f.money(structure.data.velocity.perDay)}/day` : "…"}
                  hint={structure.data ? <Delta value={structure.data.velocity.changePct} goodWhen="down" suffix="vs same point last period" /> : undefined}
                />
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Twelve months</CardTitle>
                <CardDescription>Money in vs net spending each month</CardDescription>
              </CardHeader>
              <CardContent>
                {trend.data ? (
                  <GroupedBars
                    label="Monthly income and spending for the last 12 months"
                    data={trend.data.map((p) => ({ label: p.label, income: p.income, spent: p.expenses }))}
                    series={[
                      { key: "income", name: "Money in", color: "hsl(var(--inflow))" },
                      { key: "spent", name: "Spent", color: "hsl(var(--outflow))" },
                    ]}
                    height={260}
                  />
                ) : (
                  <Skeleton className="h-64" />
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Kind of spending</CardTitle>
                <CardDescription>Based on how each category is classified in Settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {structure.data ? (
                  <>
                    <Split label="Essential vs discretionary" a={structure.data.current.essential} b={structure.data.current.discretionary} other={structure.data.current.unclassifiedClass} aLabel="Essential" bLabel="Discretionary" />
                    <Split label="Fixed vs variable" a={structure.data.current.fixed} b={structure.data.current.variable} other={structure.data.current.unclassifiedBehavior} aLabel="Fixed" bLabel="Variable" />
                    <p className="text-xs text-muted-foreground">
                      At this pace the period ends at about {f.money(structure.data.velocity.projected)} ({structure.data.velocity.elapsedDays} of {structure.data.velocity.periodDays} days so far).
                    </p>
                  </>
                ) : (
                  <Skeleton className="h-40" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Categories</CardTitle><CardDescription>{s?.period.label}</CardDescription></CardHeader>
              <CardContent>
                {!cats.data ? (
                  <Skeleton className="h-48" />
                ) : cats.data.items.filter((c) => c.total > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No spending in this period.</p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                    <Donut label="Share of spending by category" height={160} items={cats.data.items.map((c) => ({ name: c.name, value: c.total, color: c.color }))} />
                    <ul className="space-y-2">
                      {cats.data.items.filter((c) => c.total > 0).slice(0, 8).map((c) => (
                        <li key={c.categoryId ?? "none"} className="text-sm">
                          <div className="flex items-center gap-2">
                            <Swatch color={c.color} />
                            <Link className="min-w-0 flex-1 truncate hover:underline" href={`/transactions?type=EXPENSE&${c.categoryId ? `categoryId=${c.categoryId}` : "uncategorized=true"}&startDate=${s?.period.start ?? ""}&endDate=${s?.period.lastDay ?? ""}`}>{c.name}</Link>
                            <span className="font-medium num">{f.money(c.total)}</span>
                          </div>
                          <div className="ml-4 flex items-center gap-3">
                            <Progress value={c.percentage} className="h-1 flex-1" />
                            <span className="w-20 shrink-0 text-right"><Delta value={c.changePct} suffix="" /></span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Top merchants</CardTitle></CardHeader>
              <CardContent>
                {merchants.isLoading ? (
                  <Skeleton className="h-48" />
                ) : merchantItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No merchant names recorded in this period.</p>
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Top merchants by net spending</caption>
                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 font-medium">Merchant</th><th className="pb-1 text-right font-medium">Visits</th><th className="pb-1 text-right font-medium">Spent</th></tr></thead>
                    <tbody className="divide-y">
                      {merchantItems.slice(0, 10).map((m) => (
                        <tr key={m.merchant}>
                          <td className="py-1.5"><Link className="hover:underline" href={`/transactions?merchant=${encodeURIComponent(m.merchant)}`}>{m.merchant}</Link></td>
                          <td className="py-1.5 text-right num">{m.count}</td>
                          <td className="py-1.5 text-right font-medium num">{f.money(m.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Category trends</CardTitle>
                <CardDescription>Last 6 months. Rising means this month is above the average of the months before.</CardDescription>
              </CardHeader>
              <CardContent>
                {!catTrends.data ? (
                  <Skeleton className="h-40" />
                ) : (
                  <ul className="divide-y">
                    {catTrends.data.items.map((c) => (
                      <li key={c.categoryId ?? "none"} className="grid grid-cols-[1fr_120px_auto] items-center gap-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2"><Swatch color={c.color} /><span className="truncate">{c.name}</span></span>
                        <Sparkline values={c.series.map((p) => p.total)} color={c.color ?? undefined} />
                        <span className="text-right">
                          <span className="block font-medium num">{f.money(c.latest)}</span>
                          <span className={`text-xs ${c.direction === "up" ? "text-outflow" : c.direction === "down" ? "text-inflow" : "text-muted-foreground"}`}>
                            {c.direction === "flat" ? `avg ${f.money(c.average)}` : `${c.direction === "up" ? "▲" : "▼"} ${Math.abs(c.changePct ?? 0).toFixed(1)}% vs avg`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By day of week</CardTitle><CardDescription>Average net spending per day</CardDescription></CardHeader>
              <CardContent>
                {!heat.data ? (
                  <Skeleton className="h-40" />
                ) : (
                  <>
                    <GroupedBars
                      label="Average spending by weekday"
                      data={heat.data.weekdays.map((w) => ({ label: WD[w.weekday]!, avg: w.average }))}
                      series={[{ key: "avg", name: "Average", color: "hsl(var(--chart-1))" }]}
                      height={180}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">{heat.data.noSpendDays} no-spend day(s) of {heat.data.days.length} in this period.</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          <Explain title="How these numbers are calculated">
            Net spending = expenses − refunds (refunds count on their own date). Transfers and adjustments are excluded from income and spending.
            Split transactions count each part in its own category. Comparisons use the previous period of the same kind; the pace compares the same number of days.
          </Explain>
        </div>
      )}
    </>
  );
}
