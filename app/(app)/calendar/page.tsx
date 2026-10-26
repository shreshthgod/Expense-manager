"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/app/states";
import { Amount } from "@/components/app/amount";
import { useFormat, usePreferences } from "@/components/providers/app-context";
import { useApiGet, useSchedule } from "@/lib/client/hooks";
import { addDays, addMonthsClamped, dayOfWeek, lastDayOfMonth } from "@/lib/dates/date-only";
import type { ScheduledItem } from "@/server/services/recurring.service";
import { cn } from "@/lib/utils/cn";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const f = useFormat();
  const prefs = usePreferences();
  const [month, setMonth] = React.useState(() => `${f.today().slice(0, 7)}-01`);
  const [selected, setSelected] = React.useState<string>(f.today());
  const end = addDays(lastDayOfMonth(month), 1);
  const schedule = useSchedule(month, lastDayOfMonth(month));
  const spending = useApiGet<{ days: { date: string; total: number; count: number }[]; max: number }>("analytics", "/api/analytics/heatmap", { preset: "custom", startDate: month, endDate: lastDayOfMonth(month) });

  const firstDow = (dayOfWeek(month) - prefs.weekStartsOn + 7) % 7;
  const days: string[] = [];
  for (let d = month; d < end; d = addDays(d, 1)) days.push(d);
  const byDate = new Map<string, ScheduledItem[]>();
  for (const i of schedule.data ?? []) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);
  const spent = new Map((spending.data?.days ?? []).map((d) => [d.date, d.total]));
  const max = spending.data?.max ?? 0;
  const today = f.today();
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + prefs.weekStartsOn) % 7]);
  const selItems = byDate.get(selected) ?? [];
  const label = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthOut = (schedule.data ?? []).filter((i) => i.type === "EXPENSE" && i.status !== "SKIPPED").reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <PageHeader title="Calendar" description="Bills, subscriptions and recurring items by date, with what you actually spent each day." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{label}</CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setMonth(addMonthsClamped(month, -1, 1))} aria-label="Previous month"><ChevronLeft aria-hidden="true" /></Button>
              <Button variant="outline" size="xs" onClick={() => { setMonth(`${today.slice(0, 7)}-01`); setSelected(today); }}>Today</Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setMonth(addMonthsClamped(month, 1, 1))} aria-label="Next month"><ChevronRight aria-hidden="true" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {schedule.isError ? (
              <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
            ) : (
              <div role="grid" aria-label={`Calendar for ${label}`} className="grid grid-cols-7 gap-1">
                {weekdayLabels.map((w) => <div key={w} role="columnheader" className="pb-1 text-center text-xs font-medium text-muted-foreground">{w}</div>)}
                {Array.from({ length: firstDow }, (_, i) => <div key={`pad-${i}`} />)}
                {days.map((d) => {
                  const items = byDate.get(d) ?? [];
                  const s = spent.get(d) ?? 0;
                  const intensity = max > 0 && s > 0 ? Math.max(0.12, s / max) : 0;
                  const due = items.some((i) => i.status === "DUE" || i.status === "FAILED" || (i.status !== "RECORDED" && i.status !== "SKIPPED" && d < today));
                  return (
                    <button
                      key={d}
                      role="gridcell"
                      type="button"
                      aria-selected={selected === d}
                      aria-label={`${f.date(d)}: ${items.length} scheduled, spent ${f.money(s)}`}
                      onClick={() => setSelected(d)}
                      className={cn(
                        "relative flex min-h-[4.25rem] flex-col items-start gap-1 rounded-lg border p-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[5.5rem]",
                        selected === d ? "border-primary bg-primary-soft" : "hover:bg-accent/60",
                        d === today && "ring-1 ring-primary"
                      )}
                    >
                      <span className="font-medium num">{Number(d.slice(8))}</span>
                      {s > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-outflow" style={{ opacity: intensity }} aria-hidden="true" />}
                      {items.slice(0, 2).map((i) => (
                        <span key={i.key} className={cn("hidden w-full truncate rounded px-1 sm:block", i.type === "INCOME" ? "bg-inflow-soft text-inflow" : "bg-muted", i.status === "RECORDED" && "line-through opacity-60")}>
                          {i.name}
                        </span>
                      ))}
                      {items.length > 0 && <span className={cn("rounded-full px-1.5 text-[10px] sm:hidden", due ? "bg-outflow-soft text-outflow" : "bg-muted")}>{items.length}</span>}
                      {items.length > 2 && <span className="hidden text-[10px] text-muted-foreground sm:block">+{items.length - 2} more</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">A red dot marks days with spending (darker = more). Recorded items are struck through.</p>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{f.date(selected)}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">Spent: <Amount value={spent.get(selected) ?? 0} className="font-medium" /></p>
              {schedule.isLoading ? (
                <Skeleton className="h-16" />
              ) : selItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {selItems.map((i) => (
                    <li key={i.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{i.name}</span>
                        <Badge variant={i.status === "RECORDED" ? "inflow" : i.status === "SKIPPED" ? "outline" : i.status === "DUE" || i.status === "FAILED" ? "warning" : "secondary"}>
                          {i.status === "EXPECTED" || i.status === "SCHEDULED" ? "Scheduled" : i.status === "RECORDED" ? "Recorded" : i.status === "SKIPPED" ? "Skipped" : i.status === "FAILED" ? "Failed" : "Due"}
                        </Badge>
                      </span>
                      <Amount value={i.amount} direction={i.type === "INCOME" ? "in" : i.type === "EXPENSE" ? "out" : "neutral"} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="text-muted-foreground">Scheduled outgoings this month</p>
              <p className="text-xl font-semibold num">{f.money(monthOut)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
