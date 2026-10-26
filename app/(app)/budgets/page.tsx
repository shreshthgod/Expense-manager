"use client";

import * as React from "react";
import Link from "next/link";
import { LayoutTemplate, MoreHorizontal, Pencil, PieChart, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Explain, Segmented, StatTile, Swatch } from "@/components/app/kit";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { CategorySelect } from "@/components/app/pickers";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { useBudgetTemplates, useBudgets } from "@/lib/client/hooks";
import { budgetCreateSchema, budgetUpdateSchema } from "@/lib/validation/schemas";
import { buildBudgetCreateBody, buildBudgetUpdateBody, budgetFormFromStatus, emptyBudgetForm, type BudgetFormState } from "@/lib/forms/budget";
import type { BudgetStatus } from "@/server/analytics/budget-status";
import type { ApplyPlanItem } from "@/server/services/budget-template.service";

const PERIOD_LABEL = { WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly", CUSTOM: "Custom dates" } as const;
const ROLLOVER_LABEL = { NONE: "No rollover", POSITIVE_ONLY: "Carry unused money", FULL: "Carry unused and overspending" } as const;

function BudgetDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (o: boolean) => void; existing?: BudgetStatus | null }) {
  const f = useFormat();
  const { addToast } = useToast();
  const editing = !!existing;
  const init = () => (existing ? budgetFormFromStatus(existing) : emptyBudgetForm(`${f.today().slice(0, 7)}-01`));
  const [s, setS] = React.useState<BudgetFormState>(init);
  const { errors, formError, validate, handleError, clear, clearField } = useFormErrors();
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (open) {
      setS(init());
      clear();
      key.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);
  const set = <K extends keyof BudgetFormState>(k: K, v: BudgetFormState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    clearField(k as string);
  };
  const m = useFinanceMutation({
    affects: ["budget"],
    mutationFn: (body: unknown) => (editing ? api.patch(`/api/budgets/${existing!.id}`, body) : api.post("/api/budgets", body, { idempotencyKey: key.current })),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = editing ? buildBudgetUpdateBody(s, existing!.version) : buildBudgetCreateBody(s);
    if (!validate(editing ? budgetUpdateSchema : budgetCreateSchema, body)) return;
    try {
      await m.mutateAsync(body);
      addToast(editing ? "Budget updated" : "Budget created", "success");
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiClientError && err.uncertain)) key.current = newIdempotencyKey();
      handleError(err);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${existing!.name}` : "New budget"}</DialogTitle>
          <DialogDescription>Budgets track net spending (expenses minus refunds). Split transactions count per category line.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name} required>
              {(p) => <Input {...p} value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Groceries" data-autofocus />}
            </Field>
            <Field label="Limit per period" error={errors.amount} required>
              {(p) => <MoneyInput {...p} value={s.amount} onValueChange={(v) => set("amount", v)} />}
            </Field>
            <Field label="What it covers" error={errors.categoryId} hint="Leave on “All spending” for an overall budget.">
              {(p) => <CategorySelect control={p} kind="EXPENSE" allowNone noneLabel="All spending" value={s.categoryId} onChange={(v) => set("categoryId", v)} />}
            </Field>
            <Field label="Period" error={errors.period} required>
              {(p) => (
                <Select {...p} value={s.period} onChange={(e) => set("period", e.target.value as BudgetFormState["period"])}>
                  {Object.entries(PERIOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              )}
            </Field>
            <Field label={s.period === "CUSTOM" ? "Start date" : "First cycle starts"} error={errors.startDate} required>
              {(p) => <Input {...p} type="date" value={s.startDate} onChange={(e) => set("startDate", e.target.value)} />}
            </Field>
            <Field label={s.period === "CUSTOM" ? "End date" : "Stop after"} error={errors.endDate} optional={s.period !== "CUSTOM"} required={s.period === "CUSTOM"}>
              {(p) => <Input {...p} type="date" value={s.endDate} onChange={(e) => set("endDate", e.target.value)} />}
            </Field>
            {s.period !== "CUSTOM" && (
              <Field label="At the end of each period" error={errors.rolloverMode} className="sm:col-span-2" hint="Rollover adds what's left (or subtracts overspending) to the next period's limit.">
                {(p) => (
                  <Select {...p} value={s.rolloverMode} onChange={(e) => set("rolloverMode", e.target.value as BudgetFormState["rolloverMode"])}>
                    {Object.entries(ROLLOVER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{editing ? "Save changes" : "Create budget"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const q = useBudgetTemplates();
  const [name, setName] = React.useState("");
  const [applying, setApplying] = React.useState<string | null>(null);
  const [startDate, setStartDate] = React.useState("");
  const [plan, setPlan] = React.useState<ApplyPlanItem[] | null>(null);
  const [replace, setReplace] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      const t = f.today();
      const [y, m] = t.split("-").map(Number);
      setStartDate(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`);
      setPlan(null);
      setApplying(null);
    }
  }, [open, f]);
  const save = useFinanceMutation({
    affects: ["budget"],
    mutationFn: () => api.post("/api/budgets/templates", { fromCurrent: true, name: name.trim() }),
    onSuccess: () => { addToast("Template saved", "success"); setName(""); },
    onError: (e) => addToast(e.message, "error"),
  });
  const preview = async (id: string, replaceConflicts: boolean) => {
    try {
      const res = await api.post<{ plan: ApplyPlanItem[] }>(`/api/budgets/templates/${id}/apply`, { startDate, replaceConflicts, dryRun: true });
      setApplying(id);
      setPlan(res.data.plan);
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  const apply = useFinanceMutation({
    affects: ["budget"],
    mutationFn: () => api.post(`/api/budgets/templates/${applying}/apply`, { startDate, replaceConflicts: replace, dryRun: false }),
    onSuccess: (res) => { addToast(res.message ?? "Template applied", "success"); onOpenChange(false); },
    onError: (e) => addToast(e.message, "error"),
  });
  const remove = async (id: string) => {
    try {
      await api.delete(`/api/budgets/templates/${id}`);
      await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Budget templates</DialogTitle>
          <DialogDescription>Save your current budgets as a set and apply it again later — for a new year, or after changing jobs.</DialogDescription>
        </DialogHeader>
        {!plan ? (
          <div className="space-y-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(undefined); }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name, e.g. 2026 plan" aria-label="Template name" />
              <Button type="submit" variant="outline" loading={save.isPending} disabled={!name.trim()}>Save current budgets</Button>
            </form>
            <Field label="Apply from">{(p) => <Input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
            {(q.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {q.data!.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t.name}</span>
                      <span className="text-xs text-muted-foreground">{t.items.length} budget(s) · {f.money(t.total)}/month</span>
                    </span>
                    <Button size="xs" onClick={() => void preview(t.id, false)}>Preview</Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => void remove(t.id)} aria-label={`Delete template ${t.name}`}><Trash2 aria-hidden="true" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y rounded-lg border text-sm">
              {plan.map((p, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1">{p.name} <span className="text-muted-foreground">· {p.categoryName ?? "All spending"}</span></span>
                  <span className="num">{f.money(p.amount)}</span>
                  <Badge variant={p.action === "create" ? "inflow" : p.action === "replace" ? "warning" : "secondary"}>
                    {p.action === "create" ? "Create" : p.action === "replace" ? "Replace" : "Skip"}
                  </Badge>
                  {p.reason && <span className="w-full text-xs text-muted-foreground">{p.reason}</span>}
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={replace}
                onChange={(e) => { setReplace(e.target.checked); void preview(applying!, e.target.checked); }}
              />
              Replace existing budgets that cover the same thing (they end the day before, keeping their history)
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlan(null)}>Back</Button>
              <Button onClick={() => apply.mutate(undefined)} loading={apply.isPending} disabled={!plan.some((p) => p.action !== "skip")}>Apply template</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BudgetCard({ b, onEdit, onDelete }: { b: BudgetStatus; onEdit: () => void; onDelete: () => void }) {
  const f = useFormat();
  const tone = b.exceeded ? "outflow" : b.aheadOfPace ? "warning" : (b.utilization ?? 0) >= 90 ? "warning" : "default";
  const txHref = `/transactions?type=EXPENSE&startDate=${b.cycle.start}&endDate=${b.cycle.lastDay}${b.categoryId ? `&categoryId=${b.categoryId}` : ""}`;
  return (
    <Card id={`budget-${b.id}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              {b.categoryColor && <Swatch color={b.categoryColor} />}
              <span className="truncate">{b.name}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {b.categoryName ?? "All spending"} · {PERIOD_LABEL[b.period]} · {f.dateShort(b.cycle.start)} – {f.dateShort(b.cycle.lastDay)}
            </p>
          </div>
          {b.cycle.state !== "active" && <Badge variant="secondary">{b.cycle.state === "upcoming" ? "Starts later" : "Ended"}</Badge>}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Actions for ${b.name}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden="true" /> Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete}><Trash2 aria-hidden="true" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <Link href={txHref} className="text-xl font-semibold num hover:underline">{f.money(b.spent)}</Link>
          <span className="text-sm text-muted-foreground num">of {f.money(b.available)}</span>
        </div>
        <Progress value={b.utilization} tone={tone} label={`${b.utilization ?? 0}% used, ${b.elapsedPct}% of the period gone`} />
        <p className="text-xs text-muted-foreground">
          {b.exceeded ? <span className="font-medium text-outflow">Over by {f.money(b.spent - b.available)}</span> : <>{f.money(b.remaining)} left</>}
          {b.cycle.state === "active" && <> · {b.daysRemaining} day(s) to go · {b.elapsedPct}% of period gone</>}
        </p>
        {b.cycle.state === "active" && b.projectedSpend > b.available && !b.exceeded && (
          <p className="text-xs text-warning">At this pace you'll spend about {f.money(b.projectedSpend)} this period.</p>
        )}
        {b.rolloverMode !== "NONE" && (
          <p className="text-xs text-muted-foreground">
            {ROLLOVER_LABEL[b.rolloverMode]}: {b.carryIn >= 0 ? "+" : "−"}{f.money(Math.abs(b.carryIn))} carried in (limit {f.money(b.amount)})
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function BudgetsPage() {
  const q = useBudgets();
  const f = useFormat();
  const { addToast } = useToast();
  const [view, setView] = React.useState<"current" | "all">("current");
  const [creating, setCreating] = React.useState(false);
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setCreating(true);
  }, []);
  const [templates, setTemplates] = React.useState(false);
  const [editing, setEditing] = React.useState<BudgetStatus | null>(null);
  const [deleting, setDeleting] = React.useState<BudgetStatus | null>(null);
  const del = useFinanceMutation({
    affects: ["budget"],
    mutationFn: (id: string) => api.delete(`/api/budgets/${id}`),
    onSuccess: () => { addToast("Budget deleted", "success"); setDeleting(null); },
    onError: (e) => addToast(e.message, "error"),
  });
  const all = q.data ?? [];
  const list = view === "current" ? all.filter((b) => b.cycle.state === "active") : all;
  const active = all.filter((b) => b.cycle.state === "active");
  const overall = active.find((b) => !b.categoryId && b.period === "MONTHLY");
  const over = active.filter((b) => b.exceeded).length;
  React.useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus && q.data) document.getElementById(`budget-${focus}`)?.scrollIntoView({ block: "center" });
  }, [q.data]);
  return (
    <>
      <PageHeader
        title="Budgets"
        description="Spending limits per week, month, year or custom dates. An overall budget and category budgets are tracked separately, never added together."
        actions={
          <>
            <Button variant="outline" onClick={() => setTemplates(true)}><LayoutTemplate aria-hidden="true" /> Templates</Button>
            <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" /> New budget</Button>
          </>
        }
      />
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState icon={PieChart} title="No budgets yet" description="Start with one overall monthly budget, then add categories you want to watch." action={<Button onClick={() => setCreating(true)}>Create a budget</Button>} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Overall this month" value={overall ? `${f.money(overall.spent)} / ${f.money(overall.available)}` : "No overall budget"} hint={overall ? `${overall.utilization ?? 0}% used` : "Add one with “All spending”"} />
            <StatTile label="Active budgets" value={active.length} />
            <StatTile label="Over the limit" value={over} hint={over ? "See the red ones below" : "All within limits"} />
          </div>
          <div className="flex items-center justify-between">
            <Segmented label="Show" value={view} onChange={setView} options={[{ value: "current", label: "Current" }, { value: "all", label: `All (${all.length})` }]} />
            <Explain title="How budgets work">
              Spending = expenses − refunds in each budget's current period, by transaction date. Planned (future) entries aren't counted until posted.
              Pace compares the share of the limit used with the share of the period gone. Rollover carries the previous periods' result (up to 24 periods back).
            </Explain>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((b) => <BudgetCard key={b.id} b={b} onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} />)}
          </div>
        </div>
      )}
      <BudgetDialog open={creating} onOpenChange={setCreating} />
      <BudgetDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} existing={editing} />
      <TemplatesDialog open={templates} onOpenChange={setTemplates} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Only the budget is removed; your transactions are not affected."
        onConfirm={() => deleting && del.mutateAsync(deleting.id)}
      />
    </>
  );
}
