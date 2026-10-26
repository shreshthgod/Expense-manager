"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Goal as GoalIcon, History, MinusCircle, MoreHorizontal, Pencil, PiggyBank, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Explain, Segmented, StatTile } from "@/components/app/kit";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { AccountSelect } from "@/components/app/pickers";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { useEmergencyFund, useGoalContributions, useGoals } from "@/lib/client/hooks";
import { goalContributionSchema, goalCreateSchema, goalUpdateSchema } from "@/lib/validation/schemas";
import { buildGoalCreateBody, buildGoalUpdateBody, emptyGoalForm, goalFormFromStatus, type GoalFormState } from "@/lib/forms/goal";
import type { GoalKindValue, GoalStatus } from "@/server/services/goal.service";

const KIND: Record<GoalKindValue, { label: string; help: string; icon: React.ElementType }> = {
  SAVINGS: { label: "Savings goal", help: "Save up for something: a trip, a gadget, a down payment.", icon: PiggyBank },
  SINKING_FUND: { label: "Sinking fund", help: "Set money aside for a known yearly cost (insurance, fees) so it never surprises you.", icon: GoalIcon },
  EMERGENCY_FUND: { label: "Emergency fund", help: "A cushion for months without income. Measured against your essential spending.", icon: ShieldCheck },
};

function GoalDialog({ open, onOpenChange, existing, kind }: { open: boolean; onOpenChange: (o: boolean) => void; existing?: GoalStatus | null; kind?: GoalKindValue }) {
  const { addToast } = useToast();
  const editing = !!existing;
  const init = () => (existing ? goalFormFromStatus(existing) : emptyGoalForm(kind));
  const [s, setS] = React.useState<GoalFormState>(init);
  const { errors, formError, validate, handleError, clear, clearField } = useFormErrors();
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (open) {
      setS(init());
      clear();
      key.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, kind]);
  const set = <K extends keyof GoalFormState>(k: K, v: GoalFormState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    clearField(k as string);
  };
  const m = useFinanceMutation({
    affects: ["goal"],
    mutationFn: (body: unknown) => (editing ? api.patch(`/api/goals/${existing!.id}`, body) : api.post("/api/goals", body, { idempotencyKey: key.current })),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = editing ? buildGoalUpdateBody(s, existing!.version) : buildGoalCreateBody(s);
    if (!validate(editing ? goalUpdateSchema : goalCreateSchema, body)) return;
    try {
      await m.mutateAsync(body);
      addToast(editing ? "Goal updated" : "Goal created", "success");
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
          <DialogTitle>{editing ? `Edit ${existing!.name}` : `New ${KIND[s.kind].label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>{KIND[s.kind].help}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={s.name} onChange={(e) => set("name", e.target.value)} data-autofocus />}</Field>
            <Field label="Kind" error={errors.kind}>
              {(p) => (
                <Select {...p} value={s.kind} onChange={(e) => set("kind", e.target.value as GoalKindValue)}>
                  {Object.entries(KIND).map(([v, k]) => <option key={v} value={v}>{k.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Target" error={errors.targetAmount} required>{(p) => <MoneyInput {...p} value={s.targetAmount} onValueChange={(v) => set("targetAmount", v)} />}</Field>
            {!editing && (
              <Field label="Already saved" optional error={errors.currentAmount} hint="Recorded as the first contribution.">
                {(p) => <MoneyInput {...p} value={s.currentAmount} onValueChange={(v) => set("currentAmount", v)} />}
              </Field>
            )}
            <Field label="Deadline" optional error={errors.deadline}>{(p) => <Input {...p} type="date" value={s.deadline} onChange={(e) => set("deadline", e.target.value)} />}</Field>
            <Field label="Plan to add each month" optional error={errors.monthlyContribution} hint="Used to project when you'll get there and in safe-to-spend.">
              {(p) => <MoneyInput {...p} value={s.monthlyContribution} onValueChange={(v) => set("monthlyContribution", v)} />}
            </Field>
            <Field label="Money kept in" optional error={errors.accountId} hint="Optional. Warns you if goals claim more than the account holds.">
              {(p) => <AccountSelect control={p} allowNone placeholder="Not linked" value={s.accountId} onChange={(v) => set("accountId", v)} />}
            </Field>
            <Field label="Label" optional error={errors.category}>{(p) => <Input {...p} value={s.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Travel" />}</Field>
          </div>
          {s.kind === "SINKING_FUND" && (
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <span><span className="font-medium">Repeats every year</span><span className="block text-xs text-muted-foreground">After the deadline, the next deadline is a year later.</span></span>
              <Switch checked={s.repeatsYearly} onCheckedChange={(c) => set("repeatsYearly", c)} aria-label="Repeats every year" />
            </label>
          )}
          <Field label="Notes" optional error={errors.description}>{(p) => <Textarea {...p} rows={2} value={s.description} onChange={(e) => set("description", e.target.value)} />}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{editing ? "Save changes" : "Create goal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContributeDialog({ goal, release, onOpenChange }: { goal: GoalStatus | null; release: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<"earmark" | "transfer">("earmark");
  const [fromAccountId, setFrom] = React.useState("");
  const [toAccountId, setTo] = React.useState("");
  const [note, setNote] = React.useState("");
  const [date, setDate] = React.useState("");
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (goal) {
      setAmount(release ? "" : goal.monthlyContribution ? String(goal.monthlyContribution) : "");
      setMode("earmark");
      setFrom(release ? goal.accountId ?? "" : "");
      setTo(release ? "" : goal.accountId ?? "");
      setNote("");
      setDate(f.today());
      clear();
      key.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, release]);
  const m = useFinanceMutation({
    affects: ["goal", "transaction"],
    mutationFn: (body: unknown) => api.post<GoalStatus & { warnings?: string[] }>(`/api/goals/${goal!.id}/contributions`, body, { idempotencyKey: key.current }),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const n = Number(amount.replace(/,/g, ""));
    const body = { amount: release ? -n : n, date, note: note.trim() || null, mode, fromAccountId: mode === "transfer" ? fromAccountId || null : null, toAccountId: mode === "transfer" ? toAccountId || null : null };
    if (!validate(goalContributionSchema, body)) return;
    try {
      const res = await m.mutateAsync(body);
      addToast(res.message ?? "Saved", "success");
      for (const w of res.data.warnings ?? []) addToast(w, "info");
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiClientError && err.uncertain)) key.current = newIdempotencyKey();
      handleError(err);
    }
  };
  return (
    <Dialog open={!!goal} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{release ? `Take money out of ${goal?.name}` : `Add to ${goal?.name}`}</DialogTitle>
          <DialogDescription>
            {release ? `Up to ${f.money(goal?.currentAmount ?? 0)} can be released.` : `${f.money(goal?.remainingAmount ?? 0)} to go.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Segmented
            label="How"
            value={mode}
            onChange={setMode}
            options={[
              { value: "earmark", label: "Set aside (no money moves)" },
              { value: "transfer", label: "Transfer between accounts" },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {mode === "earmark"
              ? "Marks money you already hold as belonging to this goal. Account balances don't change."
              : "Also records a real transfer (e.g. from your salary account to savings). Balances change; it's not spending."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amount} required>{(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} data-autofocus />}</Field>
            <Field label="Date" error={errors.date}>{(p) => <Input {...p} type="date" value={date} max={f.today()} onChange={(e) => setDate(e.target.value)} />}</Field>
            {mode === "transfer" && (
              <>
                <Field label="From" error={errors.fromAccountId} required>{(p) => <AccountSelect control={p} value={fromAccountId} onChange={setFrom} />}</Field>
                <Field label="To" error={errors.toAccountId} required>{(p) => <AccountSelect control={p} value={toAccountId} onChange={setTo} exclude={fromAccountId} />}</Field>
              </>
            )}
          </div>
          <Field label="Note" optional>{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{release ? "Release" : "Add money"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ goal, onOpenChange }: { goal: GoalStatus | null; onOpenChange: (o: boolean) => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const q = useGoalContributions(goal?.id);
  const del = useFinanceMutation({
    affects: ["goal"],
    mutationFn: (cid: string) => api.delete<{ warnings: string[] }>(`/api/goals/${goal!.id}/contributions/${cid}`),
    onSuccess: (res) => { addToast("Entry removed", "success"); for (const w of res.data.warnings) addToast(w, "info"); void q.refetch(); },
    onError: (e) => addToast(e.message, "error"),
  });
  return (
    <Dialog open={!!goal} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{goal?.name} history</DialogTitle>
          <DialogDescription>The saved amount is the sum of these entries.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Skeleton className="h-24" />
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No contributions yet.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin">
            {q.data!.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="w-24 num">{f.dateShort(c.date)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {c.note ?? (c.amount > 0 ? "Added" : "Released")}
                  {c.transactionId ? " · transfer" : ""}
                </span>
                <span className={`font-medium num ${c.amount < 0 ? "text-outflow" : ""}`}>{c.amount < 0 ? "−" : "+"}{f.money(Math.abs(c.amount))}</span>
                <Button size="icon-sm" variant="ghost" onClick={() => del.mutate(c.id)} aria-label="Remove entry"><X aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmergencyPanel() {
  const q = useEmergencyFund();
  const f = useFormat();
  if (!q.data) return null;
  const e = q.data;
  const pct = e.targetAmount > 0 ? Math.min(100, (e.fund / e.targetAmount) * 100) : 0;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">Emergency cushion</p>
          <p className="text-sm text-muted-foreground">Target {e.targetMonths} months</p>
        </div>
        <p className="text-2xl font-semibold num">{e.monthsCovered == null ? "—" : `${e.monthsCovered} months`}</p>
        <Progress value={pct} tone={pct >= 100 ? "inflow" : pct >= 50 ? "default" : "warning"} label={`${Math.round(pct)}% of target`} />
        <p className="text-xs text-muted-foreground">
          {f.money(e.fund)} covers essential spending of {f.money(e.essentialMonthly)}/month.
          {e.shortfall > 0 ? ` ${f.money(e.shortfall)} more reaches ${e.targetMonths} months.` : " Target reached."}
        </p>
        <Explain><ul className="list-disc space-y-1 pl-4">{e.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Explain>
      </CardContent>
    </Card>
  );
}

function GoalCard({ g, onAdd, onRelease, onHistory, onEdit, onArchive, onDelete }: { g: GoalStatus; onAdd: () => void; onRelease: () => void; onHistory: () => void; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const f = useFormat();
  const K = KIND[g.kind];
  return (
    <Card id={`goal-${g.id}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <K.icon className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{g.name}</p>
            <p className="text-xs text-muted-foreground">{K.label}{g.accountName ? ` · in ${g.accountName}` : ""}{g.effectiveDeadline ? ` · by ${f.date(g.effectiveDeadline)}` : ""}</p>
          </div>
          {g.completed ? <Badge variant="inflow">Reached</Badge> : g.overdue ? <Badge variant="outflow">Past deadline</Badge> : g.onTrack === false ? <Badge variant="warning">Behind</Badge> : g.onTrack ? <Badge variant="secondary">On track</Badge> : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Actions for ${g.name}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onHistory}><History aria-hidden="true" /> History</DropdownMenuItem>
              <DropdownMenuItem onSelect={onRelease}><MinusCircle aria-hidden="true" /> Take money out</DropdownMenuItem>
              <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden="true" /> Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={onArchive}>{g.archived ? <><ArchiveRestore aria-hidden="true" /> Unarchive</> : <><Archive aria-hidden="true" /> Archive</>}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete}><Trash2 aria-hidden="true" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xl font-semibold num">{f.money(g.currentAmount)}</span>
          <span className="text-sm text-muted-foreground num">of {f.money(g.targetAmount)}</span>
        </div>
        <Progress value={g.progressPct} tone={g.completed ? "inflow" : g.onTrack === false || g.overdue ? "warning" : "default"} label={`${g.progressPct}% saved`} />
        <p className="text-xs text-muted-foreground">
          {g.completed
            ? "Goal reached."
            : [
                g.requiredMonthlySaving != null ? `${f.money(g.requiredMonthlySaving)}/month needed` : null,
                g.expectedCompletion ? `at ${g.paceSource === "planned" ? "your plan" : "your recent pace"} (${f.money(g.pace ?? 0)}/month): ${f.date(g.expectedCompletion)}` : "add money or a monthly plan to see a projection",
              ]
                .filter(Boolean)
                .join(" · ")
                .replace(/^./, (c) => c.toUpperCase())}
        </p>
        {!g.archived && !g.completed && (
          <Button size="sm" variant="outline" className="w-full" onClick={onAdd}><Plus aria-hidden="true" /> Add money</Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function GoalsPage() {
  const q = useGoals();
  const f = useFormat();
  const { addToast } = useToast();
  const [showArchived, setShowArchived] = React.useState(false);
  const archived = useFinanceMutation({
    affects: ["goal"],
    mutationFn: (g: GoalStatus) => api.patch(`/api/goals/${g.id}`, { version: g.version, archived: !g.archived }),
    onSuccess: (res) => addToast(res.message ?? "Saved", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  const [creating, setCreating] = React.useState<GoalKindValue | null>(null);
  const [editing, setEditing] = React.useState<GoalStatus | null>(null);
  const [contrib, setContrib] = React.useState<{ goal: GoalStatus; release: boolean } | null>(null);
  const [history, setHistory] = React.useState<GoalStatus | null>(null);
  const [deleting, setDeleting] = React.useState<GoalStatus | null>(null);
  const [archivedList, setArchivedList] = React.useState<GoalStatus[]>([]);
  React.useEffect(() => {
    if (showArchived) api.get<GoalStatus[]>("/api/goals", { query: { includeArchived: true } }).then((g) => setArchivedList(g.filter((x) => x.archived))).catch(() => setArchivedList([]));
  }, [showArchived, q.data]);
  const goals = q.data ?? [];
  const saved = goals.reduce((s, g) => s + g.currentAmount, 0);
  const target = goals.reduce((s, g) => s + g.targetAmount, 0);
  const monthly = goals.filter((g) => !g.completed).reduce((s, g) => s + (g.monthlyContribution ?? 0), 0);
  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/goals/${deleting.id}`);
      addToast("Goal deleted", "success");
      setDeleting(null);
      await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  const card = (g: GoalStatus) => (
    <GoalCard
      key={g.id}
      g={g}
      onAdd={() => setContrib({ goal: g, release: false })}
      onRelease={() => setContrib({ goal: g, release: true })}
      onHistory={() => setHistory(g)}
      onEdit={() => setEditing(g)}
      onArchive={() => archived.mutate(g)}
      onDelete={() => setDeleting(g)}
    />
  );
  return (
    <>
      <PageHeader
        title="Goals"
        description="Money set aside for what matters. Adding to a goal isn't spending; it's still your money."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Plus className="h-4 w-4" aria-hidden="true" /> New goal
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(Object.keys(KIND) as GoalKindValue[]).map((k) => (
                <DropdownMenuItem key={k} onSelect={() => setCreating(k)}>{React.createElement(KIND[k].icon, { "aria-hidden": true })} {KIND[k].label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="space-y-5">
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Saved towards goals" value={f.money(saved)} hint={target ? `${Math.round((saved / target) * 100)}% of ${f.money(target)}` : undefined} />
          <StatTile label="Planned per month" value={f.money(monthly)} />
          <StatTile label="Active goals" value={goals.filter((g) => !g.completed).length} hint={`${goals.filter((g) => g.completed).length} reached`} />
          <EmergencyPanel />
        </div>
        {q.isLoading ? (
          <ListSkeleton rows={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : goals.length === 0 ? (
          <EmptyState icon={PiggyBank} title="No goals yet" description="Create a goal for a trip, a yearly insurance premium or your emergency fund." action={<Button onClick={() => setCreating("SAVINGS")}>Create a goal</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{goals.map(card)}</div>
        )}
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((s) => !s)}>{showArchived ? "Hide archived goals" : "Show archived goals"}</Button>
        {showArchived && (archivedList.length ? <div className="grid gap-3 opacity-80 sm:grid-cols-2 xl:grid-cols-3">{archivedList.map(card)}</div> : <p className="text-sm text-muted-foreground">No archived goals.</p>)}
      </div>
      <GoalDialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} kind={creating ?? "SAVINGS"} />
      <GoalDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} existing={editing} />
      <ContributeDialog goal={contrib?.goal ?? null} release={!!contrib?.release} onOpenChange={(o) => !o && setContrib(null)} />
      <HistoryDialog goal={history} onOpenChange={(o) => !o && setHistory(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="The goal and its contribution history are removed. Transfers you recorded for it stay in Transactions. Archive instead to keep the history."
        onConfirm={remove}
      />
    </>
  );
}
