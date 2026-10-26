"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ErrorState, PageHeader, Refreshing } from "@/components/app/states";
import { Delta, Explain, StatTile, Swatch } from "@/components/app/kit";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { qk, useFinanceMutation } from "@/lib/client/query";
import { useMonthlyReview } from "@/lib/client/hooks";
import { addMonthsClamped } from "@/lib/dates/date-only";

function ExplainMonth({ periodStart }: { periodStart: string }) {
  const [on, setOn] = React.useState(false);
  const q = useQuery({
    queryKey: qk("insights", "explain-month", periodStart),
    queryFn: () => api.get<{ summary: string; points: string[]; usedAI: boolean }>("/api/ai/explain-month", { query: { periodStart } }),
    enabled: on,
    staleTime: 10 * 60_000,
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>In plain words</CardTitle>
        {!on && <Button size="sm" variant="outline" onClick={() => setOn(true)}><Sparkles aria-hidden="true" /> Explain this month</Button>}
      </CardHeader>
      <CardContent>
        {!on ? (
          <p className="text-sm text-muted-foreground">Get a short explanation built only from the figures on this page.</p>
        ) : q.isLoading ? (
          <Skeleton className="h-20" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-2 text-sm">
            <p>{q.data!.summary}</p>
            {q.data!.points.length > 0 && <ul className="list-disc space-y-1 pl-5">{q.data!.points.map((p) => <li key={p}>{p}</li>)}</ul>}
            <p className="text-xs text-muted-foreground">{q.data!.usedAI ? "Written by the assistant; every number was checked against your data." : "Generated from your figures (no AI provider configured or its answer didn't match the data)."}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReviewPage() {
  const params = useSearchParams();
  const [periodStart, setPeriodStart] = React.useState<string | undefined>(params.get("periodStart") ?? undefined);
  const q = useMonthlyReview(periodStart);
  const f = useFormat();
  const { addToast } = useToast();
  const [notes, setNotes] = React.useState("");
  React.useEffect(() => setNotes(q.data?.snapshot?.notes ?? ""), [q.data?.snapshot?.notes, q.data?.period.start]);
  const mark = useFinanceMutation({
    affects: ["report"],
    mutationFn: () => api.post("/api/review", { periodStart: q.data!.period.start, notes: notes.trim() || null }),
    onSuccess: () => { addToast("Month marked as reviewed", "success"); void q.refetch(); },
    onError: (e) => addToast(e.message, "error"),
  });
  const r = q.data;
  const today = f.today();
  return (
    <>
      <PageHeader
        title="Monthly review"
        description="A guided look back at one month. Marking it reviewed saves a snapshot so you can compare later."
        actions={
          r && (
            <div className="flex items-center gap-1">
              <Refreshing active={q.isFetching && !q.isLoading} />
              <Button variant="ghost" size="icon-sm" onClick={() => setPeriodStart(addMonthsClamped(r.period.start, -1))} aria-label="Previous month"><ChevronLeft aria-hidden="true" /></Button>
              <span className="min-w-[9rem] text-center text-sm font-medium">{r.period.label}</span>
              <Button variant="ghost" size="icon-sm" disabled={r.period.end > today} onClick={() => setPeriodStart(addMonthsClamped(r.period.start, 1))} aria-label="Next month"><ChevronRight aria-hidden="true" /></Button>
            </div>
          )
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : q.isError || !r ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-5">
          {!r.complete && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm">This month isn't over yet — figures are so far.</p>}
          {r.snapshot?.changedSinceReview && (
            <p role="status" className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
              Records in this month changed after you reviewed it (net spending was {f.money(r.snapshot.snapshotNetSpending ?? 0)}, now {f.money(r.totals.netSpending)}). Mark it reviewed again to update the snapshot.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Money in" value={f.money(r.totals.income)} hint={<Delta value={r.comparison.incomePct} goodWhen="up" />} />
            <StatTile label="Spent (net)" value={f.money(r.totals.netSpending)} hint={<Delta value={r.comparison.netSpendingPct} goodWhen="down" />} />
            <StatTile label="Kept" value={f.money(r.totals.surplus)} hint={r.totals.savingsRate == null ? "No income" : `${r.totals.savingsRate}% of income`} />
            <StatTile label="Net worth change" value={`${r.netWorth.change >= 0 ? "+" : "−"}${f.money(Math.abs(r.netWorth.change))}`} hint={`${f.money(r.netWorth.start)} → ${f.money(r.netWorth.end)}`} />
          </div>
          <Card>
            <CardHeader><CardTitle>Highlights</CardTitle></CardHeader>
            <CardContent><ul className="list-disc space-y-1.5 pl-5 text-sm">{r.highlights.map((h) => <li key={h}>{h}</li>)}</ul></CardContent>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Categories</CardTitle><CardDescription>vs the month before</CardDescription></CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {r.categories.filter((c) => c.total !== 0 || c.previousTotal !== 0).slice(0, 10).map((c) => (
                    <li key={c.categoryId ?? "none"} className="flex items-center gap-2 py-1.5">
                      <Swatch color={c.color} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <Delta value={c.changePct} suffix="" />
                      <span className="w-24 text-right font-medium num">{f.money(c.total)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Budgets</CardTitle></CardHeader>
              <CardContent>
                {r.budgets.length === 0 ? <p className="text-sm text-muted-foreground">No budgets covered this month.</p> : (
                  <ul className="divide-y text-sm">
                    {r.budgets.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="truncate">{b.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="num">{f.money(b.spent)} / {f.money(b.available)}</span>
                          <Badge variant={b.exceeded ? "outflow" : "inflow"}>{b.exceeded ? "Over" : "Within"}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Bills</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{r.bills.paid} paid · {r.bills.skipped} skipped · {r.bills.missed} not marked paid</p>
                {r.bills.missedItems.length > 0 && (
                  <ul className="space-y-1">
                    {r.bills.missedItems.map((b) => <li key={`${b.name}${b.dueDate}`} className="flex justify-between text-outflow"><span>{b.name} ({f.dateShort(b.dueDate)})</span><span className="num">{f.money(b.amount)}</span></li>)}
                  </ul>
                )}
                <Button asChild variant="link" size="xs" className="px-0"><Link href="/bills">Go to bills</Link></Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Goals & merchants</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {r.goals.length === 0 ? <p className="text-muted-foreground">No goal contributions this month.</p> : (
                  <ul className="space-y-1">{r.goals.map((g) => <li key={g.id} className="flex justify-between"><span>{g.name}</span><span className="num">+{f.money(g.contributed)}</span></li>)}</ul>
                )}
                {r.merchants.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Top merchants</p>
                    <ul className="space-y-1">{r.merchants.slice(0, 5).map((m) => <li key={m.merchant} className="flex justify-between"><span className="truncate">{m.merchant}</span><span className="num">{f.money(m.total)}</span></li>)}</ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {r.anomalies.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Unusual expenses</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {r.anomalies.map((a) => (
                    <li key={a.transactionId} className="flex items-start justify-between gap-3">
                      <span>
                        <Link className="font-medium hover:underline" href={`/transactions?focus=${a.transactionId}`}>{a.merchant ?? a.description ?? a.categoryName ?? "Expense"}</Link>
                        <span className="block text-xs text-muted-foreground">{a.reason}</span>
                      </span>
                      <span className="num">{f.money(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <ExplainMonth periodStart={r.period.start} />
          <Card>
            <CardHeader><CardTitle>Your notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What went well, what to change next month…" aria-label="Review notes" />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => mark.mutate(undefined)} loading={mark.isPending}>
                  <CheckCircle2 aria-hidden="true" /> {r.snapshot?.reviewedAt ? "Update review" : "Mark as reviewed"}
                </Button>
                {r.snapshot?.reviewedAt && <span className="text-sm text-muted-foreground">Reviewed {f.instant(r.snapshot.reviewedAt)}</span>}
              </div>
              <Explain>Marking a month reviewed stores its totals, category split, net worth and health score as they are now, so later changes to categories or settings don't rewrite what you saw.</Explain>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
