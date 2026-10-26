"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ErrorState } from "@/components/app/states";
import { Delta, StatTile, Swatch } from "@/components/app/kit";
import { GroupedBars } from "@/components/charts/charts";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { useApiGet } from "@/lib/client/hooks";
import type { ReportContent, ReportSummaryDTO } from "@/server/services/report.service";

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiGet<ReportSummaryDTO & { content: ReportContent | null; legacy: boolean }>("reports", `/api/reports/${id}`);
  const f = useFormat();
  const { addToast } = useToast();
  const [regenerating, setRegenerating] = React.useState(false);
  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const regenerate = async () => {
    const [y, m] = r.startDate.split("-").map(Number) as [number, number];
    setRegenerating(true);
    try {
      const res = await api.post<ReportSummaryDTO>("/api/reports", { type: r.type, year: y, month: r.type === "MONTHLY" ? m : undefined, quarter: r.type === "QUARTERLY" ? Math.ceil(m / 3) : undefined });
      window.location.assign(`/reports/${res.data.id}`);
    } catch (e) {
      addToast(errorMessage(e), "error");
      setRegenerating(false);
    }
  };
  const d = r.content?.dataset;
  const n = r.content?.narrative;
  return (
    <article className="report space-y-5 print:space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2"><Link href="/reports"><ArrowLeft aria-hidden="true" /> Reports</Link></Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void regenerate()} loading={regenerating}><RefreshCw aria-hidden="true" /> Regenerate</Button>
          {d && <Button asChild variant="outline" size="sm"><a href={`/api/reports/${id}/export?format=csv`} download><Download aria-hidden="true" /> CSV</a></Button>}
          {d && <Button asChild variant="outline" size="sm"><a href={`/api/reports/${id}/export?format=json`} download><Download aria-hidden="true" /> JSON</a></Button>}
          <Button size="sm" onClick={() => window.print()}><Printer aria-hidden="true" /> Print / PDF</Button>
        </div>
      </div>
      <header>
        <h1 className="text-2xl font-semibold">{r.title}</h1>
        <p className="text-sm text-muted-foreground">
          {f.date(r.startDate)} – {f.date(r.endDate)} · generated {f.instant(r.createdAt, true)}{d ? ` · ${d.timezone}` : ""}
        </p>
        {r.stale && <Badge variant="warning" className="mt-2 print:hidden">Records in this period changed after it was generated — regenerate for current figures.</Badge>}
      </header>
      {r.legacy || !d ? (
        <Card><CardContent className="p-5 text-sm">This report was created by an earlier version and only has a summary: {r.summary}. Regenerate it for full details.</CardContent></Card>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-2 text-base font-semibold">Summary</h2>
            <p className="text-sm leading-relaxed">{n?.executiveSummary}</p>
            <p className="mt-2 text-xs text-muted-foreground">{n?.usedAI ? "Summary written by the assistant from the figures below." : "Summary generated from the figures below."}</p>
          </section>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Money in" value={f.money(d.totals.income)} hint={<Delta value={d.changes.incomePct} goodWhen="up" />} />
            <StatTile label="Spent (net)" value={f.money(d.totals.netSpending)} hint={<Delta value={d.changes.netSpendingPct} goodWhen="down" />} />
            <StatTile label="Kept" value={f.money(d.totals.surplus)} hint={d.totals.savingsRate == null ? "No income" : `${d.totals.savingsRate}%`} />
            <StatTile label="Health score" value={`${d.healthScore.score}/100`} hint={d.healthScore.grade} />
          </div>
          {d.trend.points.length > 1 && (
            <Card>
              <CardHeader><CardTitle>Over the period</CardTitle></CardHeader>
              <CardContent>
                <GroupedBars label="Income and spending over the report period" data={d.trend.points.map((p) => ({ label: p.label, income: p.income, spent: p.expenses }))} series={[{ key: "income", name: "Money in", color: "hsl(var(--inflow))" }, { key: "spent", name: "Spent", color: "hsl(var(--outflow))" }]} />
              </CardContent>
            </Card>
          )}
          <div className="grid gap-5 lg:grid-cols-2 print:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Spending by category</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 font-medium">Category</th><th className="pb-1 text-right font-medium">Share</th><th className="pb-1 text-right font-medium">Net</th></tr></thead>
                  <tbody className="divide-y">
                    {d.categories.filter((c) => c.total !== 0).map((c) => (
                      <tr key={c.categoryId ?? "none"}><td className="py-1.5"><span className="flex items-center gap-2"><Swatch color={c.color} />{c.name}</span></td><td className="py-1.5 text-right num">{c.percentage}%</td><td className="py-1.5 text-right num">{f.money(c.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Income sources</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">{d.incomeSources.map((c) => <li key={c.categoryId ?? "none"} className="flex justify-between py-1.5"><span>{c.name}</span><span className="num">{f.money(c.total)}</span></li>)}</ul>
                {d.merchants.length > 0 && (
                  <>
                    <h3 className="mb-1 mt-4 text-sm font-medium">Top merchants</h3>
                    <ul className="divide-y text-sm">{d.merchants.slice(0, 6).map((m) => <li key={m.merchant} className="flex justify-between py-1.5"><span>{m.merchant}</span><span className="num">{f.money(m.total)}</span></li>)}</ul>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Budgets</CardTitle></CardHeader>
              <CardContent>
                {d.budgets.length === 0 ? <p className="text-sm text-muted-foreground">No budgets.</p> : (
                  <ul className="divide-y text-sm">{d.budgets.map((b) => <li key={b.id} className="flex justify-between gap-2 py-1.5"><span>{b.name}</span><span className={`num ${b.exceeded ? "text-outflow" : ""}`}>{f.money(b.spent)} / {f.money(b.available ?? b.amount)}</span></li>)}</ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Goals</CardTitle></CardHeader>
              <CardContent>
                {d.goals.length === 0 ? <p className="text-sm text-muted-foreground">No goals.</p> : (
                  <ul className="divide-y text-sm">{d.goals.map((g) => <li key={g.id} className="flex justify-between py-1.5"><span>{g.name}</span><span className="num">{g.progressPct}%</span></li>)}</ul>
                )}
              </CardContent>
            </Card>
          </div>
          {(n?.insights.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle>Observations</CardTitle></CardHeader>
              <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{n!.insights.map((i) => <li key={i}>{i}</li>)}</ul></CardContent>
            </Card>
          )}
          {(n?.recommendations.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle>Suggestions</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {n!.recommendations.map((rec) => (
                  <div key={rec.title}>
                    <p className="font-medium">{rec.title}</p>
                    <p className="text-muted-foreground">{rec.detail}</p>
                    <p className="text-xs text-muted-foreground">{rec.expectedImpact}</p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Informational only, not financial advice.</p>
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">
            Net spending = expenses − refunds; transfers and adjustments excluded. Balances shown are as of generation. Formula version {d.formulaVersion}.
          </p>
        </>
      )}
    </article>
  );
}
