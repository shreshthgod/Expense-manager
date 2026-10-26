"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Inbox, Landmark, Plus, Settings2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Amount } from "@/components/app/amount";
import { EmptyState, ErrorState, PageHeader, Refreshing } from "@/components/app/states";
import { Delta, Explain, Segmented, Swatch } from "@/components/app/kit";
import { Donut, GroupedBars } from "@/components/charts/charts";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { qk, useFinanceMutation } from "@/lib/client/query";
import { useDashboard, useInbox, usePreferencesQuery, useSafeToSpend } from "@/lib/client/hooks";
import type { InsightsResult } from "@/server/services/insight.service";
import { cn } from "@/lib/utils/cn";

type Period = "this_week" | "this_month" | "last_month" | "this_year";

const SECTIONS = [
  { id: "safe", label: "Safe to spend & upcoming" },
  { id: "trend", label: "Income vs spending trend" },
  { id: "categories", label: "Spending by category" },
  { id: "budgets", label: "Budgets" },
  { id: "goals", label: "Goals" },
  { id: "insights", label: "Insights" },
  { id: "recent", label: "Recent transactions" },
] as const;

function useLayout() {
  const prefs = usePreferencesQuery();
  const layout = (prefs.data?.dashboardLayout ?? null) as { order: string[]; hidden: string[]; period: Period } | null;
  return { hidden: new Set(layout?.hidden ?? []), period: layout?.period ?? "this_month", layout, loaded: !!prefs.data };
}

function CustomizeDialog({ open, onOpenChange, hidden, period }: { open: boolean; onOpenChange: (o: boolean) => void; hidden: Set<string>; period: Period }) {
  const [draft, setDraft] = React.useState<Set<string>>(hidden);
  const { addToast } = useToast();
  React.useEffect(() => {
    if (open) setDraft(new Set(hidden));
  }, [open, hidden]);
  const save = useFinanceMutation({
    affects: ["preferences"],
    mutationFn: () =>
      api.patch("/api/preferences", { dashboardLayout: { order: SECTIONS.map((s) => s.id), hidden: [...draft], period } }),
    onSuccess: () => {
      addToast("Dashboard updated", "success");
      onOpenChange(false);
    },
    onError: (e) => addToast(e.message, "error"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Customise dashboard</DialogTitle>
          <DialogDescription>Choose which sections appear. Your figures don't change.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
                <Checkbox
                  checked={!draft.has(s.id)}
                  onCheckedChange={(c) =>
                    setDraft((d) => {
                      const n = new Set(d);
                      if (c) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    })
                  }
                />
                {s.label}
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
            Save layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LedgerHero({ data }: { data: NonNullable<ReturnType<typeof useDashboard>["data"]> }) {
  const f = useFormat();
  const c = data.summary.current;
  return (
    <section aria-labelledby="ledger-title" className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ledger-title" className="text-sm font-medium text-muted-foreground">
          {data.summary.period.label}
        </h2>
        <Explain title="What do these mean?">
          <p>
            <strong>Money in</strong> is income recorded in the period. <strong>Spent</strong> is expenses minus refunds (net spending).
            Transfers between your accounts and balance adjustments are never counted as income or spending. <strong>Kept</strong> = money in − spent.
            Planned (future) entries are excluded until they're posted.
          </p>
        </Explain>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-end">
        <div>
          <dt className="text-sm text-muted-foreground">Money in</dt>
          <dd className="mt-1 text-2xl font-semibold text-inflow num sm:text-3xl">{f.money(c.income)}</dd>
          <dd className="mt-1"><Delta value={data.summary.changes.incomePct} goodWhen="up" /></dd>
        </div>
        <div aria-hidden="true" className="hidden pb-8 text-2xl text-muted-foreground sm:block">−</div>
        <div>
          <dt className="text-sm text-muted-foreground">Spent</dt>
          <dd className="mt-1 text-2xl font-semibold text-outflow num sm:text-3xl">{f.money(c.netSpending)}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {c.refunds > 0 ? <>after {f.money(c.refunds)} refunds · </> : null}
            <Delta value={data.summary.changes.netSpendingPct} goodWhen="down" />
          </dd>
        </div>
        <div aria-hidden="true" className="hidden pb-8 text-2xl text-muted-foreground sm:block">=</div>
        <div>
          <dt className="text-sm text-muted-foreground">Kept</dt>
          <dd className={cn("mt-1 text-2xl font-semibold num sm:text-3xl", c.surplus < 0 && "text-outflow")}>{f.money(c.surplus)}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{c.savingsRate == null ? "Savings rate: not applicable (no income)" : `${c.savingsRate}% of income`}</dd>
        </div>
      </dl>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Net worth</p>
          <p className="font-semibold num">{f.money(data.balances.netWorth)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cash & bank</p>
          <p className="font-semibold num">{f.money(data.balances.liquid)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Owed on cards & loans</p>
          <p className="font-semibold num">{f.money(data.balances.totalLiabilities)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Subscriptions</p>
          <p className="font-semibold num">{f.money(data.subscriptions.monthlyTotal)}/mo</p>
        </div>
      </div>
    </section>
  );
}

function SafeToSpendCard() {
  const q = useSafeToSpend();
  const f = useFormat();
  if (q.isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Safe to spend</CardTitle>
        <CardDescription>Until {f.date(s.period.lastDay)} · {s.daysLeft} day(s) left</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={cn("text-3xl font-semibold num", s.safeToSpend < 0 && "text-outflow")}>{f.money(s.safeToSpend)}</p>
        <p className="text-sm text-muted-foreground">
          {s.perDay != null ? <>About <span className="font-medium text-foreground num">{f.money(s.perDay)}</span> a day.</> : "Upcoming commitments exceed your cash right now."}
          {s.expectedIncome > 0 && <> {f.money(s.safeToSpendWithIncome)} if expected income of {f.money(s.expectedIncome)} arrives.</>}
        </p>
        <Explain>
          <ul className="space-y-1">
            {s.lines.map((l) => (
              <li key={l.label} className="flex justify-between gap-3">
                <span>{l.label}</span>
                <span className="num">{f.money(l.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">{s.formula}</p>
        </Explain>
        <Button asChild variant="link" className="h-auto px-0">
          <Link href="/cash-flow">
            See the cash-flow forecast <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function UpcomingCard({ data }: { data: NonNullable<ReturnType<typeof useDashboard>["data"]> }) {
  const f = useFormat();
  const items = data.upcoming.filter((u) => u.status !== "RECORDED" && u.status !== "SKIPPED").slice(0, 6);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Coming up</CardTitle>
          <CardDescription>Bills, subscriptions and recurring items</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/calendar">Calendar</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled in the next two weeks.</p>
        ) : (
          <ul className="divide-y">
            {items.map((u) => (
              <li key={u.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.relative(u.date)}
                    {u.status === "DUE" && u.date < data.today ? " · overdue" : ""}
                  </span>
                </span>
                <Amount value={u.amount} direction={u.type === "INCOME" ? "in" : u.type === "EXPENSE" ? "out" : "neutral"} className="text-sm font-medium" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InsightsSection() {
  const q = useQuery({ queryKey: qk("insights"), queryFn: () => api.get<InsightsResult & { aiAvailable: boolean }>("/api/ai/insights"), staleTime: 5 * 60_000 });
  const f = useFormat();
  if (q.isLoading) return <Skeleton className="h-32 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const cards = q.data.cards.slice(0, 4);
  if (!cards.length) return null;
  return (
    <section aria-labelledby="insights-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="insights-title" className="text-base font-semibold">What stands out</h2>
        <Button asChild variant="ghost" size="sm">
          <Link href="/assistant"><Sparkles aria-hidden="true" /> Ask the assistant</Link>
        </Button>
      </div>
      {q.data.narrative && <p className="mb-3 max-w-3xl text-sm text-muted-foreground">{q.data.narrative.text}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.id} className={cn(c.severity === "warning" && "border-warning/40")}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">{c.title}</p>
                <Badge variant={c.severity === "warning" ? "warning" : c.severity === "positive" ? "inflow" : "secondary"}>
                  {c.metric.unit === "money" ? f.money(c.metric.value) : c.metric.unit === "percent" ? `${c.metric.value}%` : c.metric.value}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{c.body}</p>
              <div className="flex items-center justify-between gap-2">
                <Explain title="Why am I seeing this?">
                  <p className="mb-1">{c.source.description}</p>
                  <ul>
                    {c.why.map((w) => (
                      <li key={w.label} className="flex justify-between gap-3">
                        <span>{w.label}</span>
                        <span className="num">{w.value}</span>
                      </li>
                    ))}
                  </ul>
                </Explain>
                {c.link && (
                  <Button asChild variant="link" size="xs" className="px-0">
                    <Link href={c.link}>Open</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const layout = useLayout();
  const [period, setPeriod] = React.useState<Period>("this_month");
  const [customize, setCustomize] = React.useState(false);
  React.useEffect(() => {
    if (layout.loaded) setPeriod(layout.period);
  }, [layout.loaded, layout.period]);
  const q = useDashboard(period);
  const inbox = useInbox();
  const tx = useTransactionDialog();
  const f = useFormat();
  const show = (id: string) => !layout.hidden.has(id);

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Refreshing active={q.isFetching && !q.isLoading} />
            <Segmented
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "this_week", label: "Week" },
                { value: "this_month", label: "Month" },
                { value: "last_month", label: "Last month" },
                { value: "this_year", label: "Year" },
              ]}
            />
            <Button variant="outline" size="icon" onClick={() => setCustomize(true)} aria-label="Customise dashboard">
              <Settings2 aria-hidden="true" />
            </Button>
          </>
        }
      />
      <CustomizeDialog open={customize} onOpenChange={setCustomize} hidden={layout.hidden} period={period} />

      {q.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-56 rounded-2xl" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.hasAnyData ? (
        <EmptyState
          icon={Landmark}
          title="Start with your accounts"
          description="Add the bank accounts, cards and cash you use, then record a transaction or import a bank statement. Every figure here is calculated from what you record."
          action={
            <>
              <Button asChild>
                <Link href="/accounts?new=1"><Plus aria-hidden="true" /> Add an account</Link>
              </Button>
              <Button variant="outline" onClick={() => tx.openCreate()}>Record a transaction</Button>
              <Button asChild variant="outline">
                <Link href="/import"><Upload aria-hidden="true" /> Import a statement</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          {(inbox.data?.total ?? 0) > 0 && (
            <Link
              href="/inbox"
              className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Inbox className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="flex-1">
                <span className="font-medium">{inbox.data!.total} item(s) need your attention</span>
                <span className="text-muted-foreground"> — {inbox.data!.items[0]?.title}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />
            </Link>
          )}

          <LedgerHero data={q.data} />

          {show("safe") && (
            <div className="grid gap-4 lg:grid-cols-2">
              <SafeToSpendCard />
              <UpcomingCard data={q.data} />
            </div>
          )}

          {(show("trend") || show("categories")) && (
            <div className="grid gap-4 lg:grid-cols-5">
              {show("trend") && (
                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle>Money in vs spent</CardTitle>
                    <CardDescription>Last {q.data.monthlyTrend.length} months</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <GroupedBars
                      label={`Monthly income and net spending: ${q.data.monthlyTrend.map((p) => `${p.label} in ${f.money(p.income)}, spent ${f.money(p.expenses)}`).join("; ")}`}
                      data={q.data.monthlyTrend.map((p) => ({ label: p.label, income: p.income, spent: p.expenses }))}
                      series={[
                        { key: "income", name: "Money in", color: "hsl(var(--inflow))" },
                        { key: "spent", name: "Spent", color: "hsl(var(--outflow))" },
                      ]}
                    />
                  </CardContent>
                </Card>
              )}
              {show("categories") && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Where it went</CardTitle>
                    <CardDescription>{q.data.summary.period.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {q.data.categoryBreakdown.filter((c) => c.total > 0).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No spending in this period.</p>
                    ) : (
                      <>
                        <Donut
                          label="Spending by category"
                          height={160}
                          items={q.data.categoryBreakdown.slice(0, 6).map((c) => ({ name: c.name, value: c.total, color: c.color }))}
                        />
                        <ul className="mt-3 space-y-1.5">
                          {q.data.categoryBreakdown.filter((c) => c.total > 0).slice(0, 5).map((c) => (
                            <li key={c.categoryId ?? "none"} className="flex items-center gap-2 text-sm">
                              <Swatch color={c.color} />
                              <Link href={`/transactions?${c.categoryId ? `categoryId=${c.categoryId}` : "uncategorized=true"}&type=EXPENSE&startDate=${q.data!.summary.period.start}&endDate=${q.data!.summary.period.lastDay}`} className="min-w-0 flex-1 truncate hover:underline">
                                {c.name}
                              </Link>
                              <span className="text-xs text-muted-foreground num">{c.percentage}%</span>
                              <span className="w-24 text-right font-medium num">{f.money(c.total)}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {(show("budgets") || show("goals")) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {show("budgets") && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Budgets</CardTitle>
                    <Button asChild variant="ghost" size="sm"><Link href="/budgets">All budgets</Link></Button>
                  </CardHeader>
                  <CardContent>
                    {q.data.budgets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No budgets yet. <Link className="text-primary underline" href="/budgets">Set one up</Link> to see how you're pacing.
                      </p>
                    ) : (
                      <ul className="space-y-4">
                        {q.data.budgets.slice(0, 4).map((b) => (
                          <li key={b.id}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                              <span className="truncate font-medium">{b.name}</span>
                              <span className="text-muted-foreground num">
                                {f.money(b.spent)} of {f.money(b.available)}
                              </span>
                            </div>
                            <Progress value={b.utilization} tone={b.exceeded ? "outflow" : b.aheadOfPace ? "warning" : "default"} label={`${b.utilization ?? 0}% used`} />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {b.exceeded ? `Over by ${f.money(b.spent - b.available)}` : `${f.money(b.remaining)} left · ${b.daysRemaining} day(s) to go`}
                              {b.aheadOfPace && !b.exceeded ? " · spending faster than time" : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
              {show("goals") && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Goals</CardTitle>
                    <Button asChild variant="ghost" size="sm"><Link href="/goals">All goals</Link></Button>
                  </CardHeader>
                  <CardContent>
                    {q.data.goals.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No goals yet. <Link className="text-primary underline" href="/goals">Create one</Link> for a trip, an emergency fund or a yearly bill.
                      </p>
                    ) : (
                      <ul className="space-y-4">
                        {q.data.goals.slice(0, 4).map((g) => (
                          <li key={g.id}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                              <span className="truncate font-medium">{g.name}</span>
                              <span className="text-muted-foreground num">{f.money(g.currentAmount)} of {f.money(g.targetAmount)}</span>
                            </div>
                            <Progress value={g.progressPct} tone={g.completed ? "inflow" : g.onTrack === false ? "warning" : "default"} />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {g.completed
                                ? "Reached"
                                : g.expectedCompletion
                                  ? `At this pace: ${f.date(g.expectedCompletion)}${g.onTrack === false ? " — after the deadline" : ""}`
                                  : g.requiredMonthlySaving != null
                                    ? `${f.money(g.requiredMonthlySaving)}/month needed`
                                    : "Add a monthly plan to see when you'll get there"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {show("insights") && <InsightsSection />}

          {show("recent") && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Recent transactions</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/transactions">View all</Link></Button>
              </CardHeader>
              <div className="divide-y border-t">
                {q.data.recentTransactions.length === 0 ? (
                  <p className="p-5 text-sm text-muted-foreground">No transactions yet.</p>
                ) : (
                  q.data.recentTransactions.slice(0, 8).map((t) => <TransactionRow key={t.id} t={t} onOpen={(x) => tx.openEdit(x.id)} />)
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
