"use client";

import * as React from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ErrorState, PageHeader, Refreshing } from "@/components/app/states";
import { Explain, Segmented, StatTile } from "@/components/app/kit";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { Amount } from "@/components/app/amount";
import { TimeSeries } from "@/components/charts/charts";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { useFormErrors } from "@/lib/client/form";
import { useCashFlow, useSafeToSpend } from "@/lib/client/hooks";
import { whatIfSchema } from "@/lib/validation/schemas";
import type { WhatIfResult } from "@/server/services/planning.service";

function Forecast() {
  const f = useFormat();
  const [days, setDays] = React.useState("45");
  const [income, setIncome] = React.useState("with");
  const q = useCashFlow(Number(days), income === "with");
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Cash-flow forecast</CardTitle>
          <CardDescription>Your bank, savings, cash and wallet money, day by day.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Refreshing active={q.isFetching && !q.isLoading} />
          <Segmented label="Expected income" size="xs" value={income} onChange={setIncome} options={[{ value: "with", label: "With expected income" }, { value: "without", label: "Bills only" }]} />
          <Segmented label="Horizon" size="xs" value={days} onChange={setDays} options={[{ value: "30", label: "30d" }, { value: "45", label: "45d" }, { value: "90", label: "90d" }]} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <Skeleton className="h-64" />
        ) : q.isError || !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            {q.data.firstNegativeDate && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-outflow/30 bg-outflow-soft p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-outflow" aria-hidden="true" />
                <span>Your cash is projected to go below zero on <strong>{f.date(q.data.firstNegativeDate)}</strong>. Consider moving money or rescheduling a payment.</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
              <StatTile label="Today" value={f.money(q.data.startingLiquid)} />
              <StatTile label="Coming in" value={<span className="text-inflow">{f.money(q.data.totals.inflow)}</span>} />
              <StatTile label="Going out" value={<span className="text-outflow">{f.money(q.data.totals.outflow)}</span>} />
              <StatTile label={`Lowest (${f.dateShort(q.data.lowest.date)})`} value={<span className={q.data.lowest.balance < 0 ? "text-outflow" : ""}>{f.money(q.data.lowest.balance)}</span>} />
            </div>
            <TimeSeries
              label={`Projected cash from ${q.data.startingLiquid} to ${q.data.endingBalance}`}
              data={q.data.days.map((d) => ({ label: f.dateShort(d.date), balance: d.balance }))}
              series={[{ key: "balance", name: "Projected cash", color: "hsl(var(--chart-1))" }]}
              zeroLine
              height={260}
            />
            <Explain title="What's included?"><ul className="list-disc space-y-1 pl-4">{q.data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Explain>
            <div>
              <h3 className="mb-2 text-sm font-medium">Scheduled movements</h3>
              {q.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled in this period. Add bills and recurring income to make the forecast useful.</p>
              ) : (
                <ul className="divide-y rounded-lg border text-sm">
                  {q.data.items.map((i) => (
                    <li key={i.key} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-20 shrink-0 text-muted-foreground num">{f.dateShort(i.date)}</span>
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      {i.overdue && <Badge variant="outflow">Overdue</Badge>}
                      {i.source === "planned" && <Badge variant="secondary">Planned</Badge>}
                      {i.source === "card_due" && <Badge variant="warning">Card due</Badge>}
                      <Amount value={Math.abs(i.amount)} direction={i.amount > 0 ? "in" : "out"} className="font-medium" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SafeToSpendPanel() {
  const q = useSafeToSpend();
  const f = useFormat();
  if (q.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Safe to spend</CardTitle>
        <CardDescription>Until {f.date(s.period.lastDay)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-3xl font-semibold num ${s.safeToSpend < 0 ? "text-outflow" : ""}`}>{f.money(s.safeToSpend)}</p>
        {s.perDay != null && <p className="text-sm text-muted-foreground">≈ {f.money(s.perDay)} a day for {s.daysLeft} day(s)</p>}
        <dl className="space-y-1.5 border-t pt-3 text-sm">
          {s.lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="shrink-0 whitespace-nowrap num">{f.money(l.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t pt-1.5 font-medium">
            <dt>Safe to spend</dt>
            <dd className="num">{f.money(s.safeToSpend)}</dd>
          </div>
          {s.expectedIncome > 0 && (
            <div className="flex justify-between gap-3 text-muted-foreground">
              <dt>If expected income ({f.money(s.expectedIncome)}) arrives</dt>
              <dd className="num">{f.money(s.safeToSpendWithIncome)}</dd>
            </div>
          )}
        </dl>
        <Explain>{s.formula}</Explain>
      </CardContent>
    </Card>
  );
}

function WhatIf() {
  const f = useFormat();
  const { addToast } = useToast();
  const [form, setForm] = React.useState({ oneTimeExpense: "", monthlyExpenseChange: "", monthlyIncomeChange: "", monthlySavingsIncrease: "", months: "12" });
  const [result, setResult] = React.useState<(WhatIfResult & { narrative?: { summary: string; points: string[]; usedAI: boolean } }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const run = async (explain: boolean) => {
    clear();
    const clean = (v: string) => (v.trim() === "" ? null : v.replace(/,/g, ""));
    const body = {
      oneTimeExpense: clean(form.oneTimeExpense),
      monthlyExpenseChange: clean(form.monthlyExpenseChange),
      monthlyIncomeChange: clean(form.monthlyIncomeChange),
      monthlySavingsIncrease: clean(form.monthlySavingsIncrease),
      months: form.months,
      explain,
    };
    if (!validate(whatIfSchema, body)) return;
    setBusy(true);
    try {
      setResult((await api.post<typeof result>("/api/planning/what-if", body)).data);
    } catch (e) {
      handleError(e);
      addToast("Couldn't run the scenario", "error");
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>What if…</CardTitle>
        <CardDescription>Try a big purchase, a raise or a new expense and see where your cash would be. Nothing is saved.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="One-time cost" error={errors.oneTimeExpense}>{(p) => <MoneyInput {...p} value={form.oneTimeExpense} onValueChange={set("oneTimeExpense")} />}</Field>
          <Field label="Extra spending / month" error={errors.monthlyExpenseChange} hint="Negative = spend less">{(p) => <MoneyInput {...p} allowNegative value={form.monthlyExpenseChange} onValueChange={set("monthlyExpenseChange")} />}</Field>
          <Field label="Extra income / month" error={errors.monthlyIncomeChange} hint="Negative = earn less">{(p) => <MoneyInput {...p} allowNegative value={form.monthlyIncomeChange} onValueChange={set("monthlyIncomeChange")} />}</Field>
          <Field label="Extra to goals / month" error={errors.monthlySavingsIncrease}>{(p) => <MoneyInput {...p} value={form.monthlySavingsIncrease} onValueChange={set("monthlySavingsIncrease")} />}</Field>
          <Field label="Months ahead" error={errors.months}>{(p) => <Input {...p} inputMode="numeric" value={form.months} onChange={(e) => set("months")(e.target.value.replace(/\D/g, "").slice(0, 2))} />}</Field>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void run(false)} loading={busy}>Run scenario</Button>
          <Button variant="outline" onClick={() => void run(true)} disabled={busy}><Sparkles aria-hidden="true" /> Run and explain</Button>
        </div>
        {result && (
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatTile label="Without change" value={f.money(result.endBaseline)} hint={`after ${form.months} month(s)`} />
              <StatTile label="With change" value={f.money(result.endScenario)} />
              <StatTile label="Difference" value={<span className={result.difference < 0 ? "text-outflow" : "text-inflow"}>{result.difference >= 0 ? "+" : "−"}{f.money(Math.abs(result.difference))}</span>} />
              <StatTile label="Emergency cover after" value={result.emergencyMonthsAfter == null ? "—" : `${result.emergencyMonthsAfter} months`} hint={result.firstNegativeMonth != null ? `Cash runs out in month ${result.firstNegativeMonth}` : "Cash stays positive"} />
            </div>
            <TimeSeries
              label="Projected cash with and without the change"
              data={result.series.map((p) => ({ label: f.dateShort(p.date), baseline: p.baseline, scenario: p.scenario }))}
              series={[
                { key: "baseline", name: "Without change", color: "hsl(var(--muted-foreground))", dashed: true },
                { key: "scenario", name: "With change", color: "hsl(var(--chart-1))" },
              ]}
              area={false}
              zeroLine
            />
            {result.narrative && (
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <p>{result.narrative.summary}</p>
                {result.narrative.points.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{result.narrative.points.map((p) => <li key={p}>{p}</li>)}</ul>}
                <p className="mt-2 text-xs text-muted-foreground">{result.narrative.usedAI ? "Written by the assistant from the figures above." : "Summary generated from the figures above."}</p>
              </div>
            )}
            <Explain><ul className="list-disc space-y-1 pl-4">{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Explain>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CashFlowPage() {
  return (
    <>
      <PageHeader title="Cash flow" description="Where your cash is heading based on what's scheduled, how much is safe to spend, and what-if scenarios." />
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2"><Forecast /></div>
          <SafeToSpendPanel />
        </div>
        <WhatIf />
      </div>
    </>
  );
}
