"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, CheckCircle2, MoreHorizontal, Pause, Pencil, Play, Plus, SkipForward, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { Segmented, StatTile, Swatch } from "@/components/app/kit";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { AccountSelect, CategorySelect } from "@/components/app/pickers";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { useRecurring } from "@/lib/client/hooks";
import { describeRecurrence } from "@/lib/finance/recurrence";
import { recurringCreateSchema, recurringUpdateSchema } from "@/lib/validation/schemas";
import { buildRecurringCreateBody, buildRecurringUpdateBody, emptyRecurringForm, recurringFormFromDTO, type RecurringFormState } from "@/lib/forms/recurring";
import type { BillState, RecurringDTO } from "@/server/services/recurring.service";
import { cn } from "@/lib/utils/cn";

type Kind = "STANDARD" | "BILL" | "SUBSCRIPTION";

export const STATE_LABEL: Record<BillState, { label: string; variant: "default" | "secondary" | "warning" | "outflow" | "inflow" | "outline" }> = {
  UPCOMING: { label: "Upcoming", variant: "secondary" },
  DUE_SOON: { label: "Due soon", variant: "warning" },
  DUE_TODAY: { label: "Due today", variant: "warning" },
  OVERDUE: { label: "Overdue", variant: "outflow" },
  PAID: { label: "Paid", variant: "inflow" },
  PAUSED: { label: "Paused", variant: "outline" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
  ENDED: { label: "Ended", variant: "outline" },
};

const NOUN: Record<Kind, string> = { STANDARD: "recurring item", BILL: "bill", SUBSCRIPTION: "subscription" };

export function RecurringFormDialog({
  open,
  onOpenChange,
  kind,
  existing,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: Kind;
  existing?: RecurringDTO | null;
  defaults?: Partial<RecurringFormState>;
}) {
  const f = useFormat();
  const { addToast } = useToast();
  const editing = !!existing;
  const init = () => (existing ? recurringFormFromDTO(existing) : { ...emptyRecurringForm(f.today(), kind), ...defaults });
  const [s, setS] = React.useState<RecurringFormState>(init);
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
  const set = <K extends keyof RecurringFormState>(k: K, v: RecurringFormState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    clearField(k as string);
  };
  const m = useFinanceMutation({
    affects: ["recurring"],
    mutationFn: (body: unknown) => (editing ? api.patch(`/api/recurring/${existing!.id}`, body) : api.post("/api/recurring", body, { idempotencyKey: key.current })),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = editing ? buildRecurringUpdateBody(s, existing!.version) : buildRecurringCreateBody(s);
    if (!validate(editing ? recurringUpdateSchema : recurringCreateSchema, body)) return;
    try {
      await m.mutateAsync(body);
      addToast(editing ? "Saved — future dates use the new details" : `${NOUN[s.kind][0].toUpperCase()}${NOUN[s.kind].slice(1)} added`, "success");
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiClientError && err.uncertain)) key.current = newIdempotencyKey();
      handleError(err);
    }
  };
  const standard = s.kind === "STANDARD";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${existing!.name}` : `New ${NOUN[kind]}`}</DialogTitle>
          <DialogDescription>
            {editing ? "Changes apply to dates that haven't been recorded yet. Past records stay as they were." : "The first date is the start date or the next matching date from today. Past dates aren't back-filled."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name} required>
              {(p) => <Input {...p} value={s.name} onChange={(e) => set("name", e.target.value)} placeholder={kind === "SUBSCRIPTION" ? "e.g. Netflix" : kind === "BILL" ? "e.g. Electricity" : "e.g. Salary"} data-autofocus />}
            </Field>
            {standard && (
              <Field label="Type" error={errors.type} required>
                {(p) => (
                  <Select {...p} value={s.type} onChange={(e) => set("type", e.target.value as RecurringFormState["type"])}>
                    <option value="EXPENSE">Expense</option>
                    <option value="INCOME">Income</option>
                    <option value="TRANSFER">Transfer</option>
                  </Select>
                )}
              </Field>
            )}
            <Field label="Amount" error={errors.amount} required hint={kind !== "STANDARD" ? "For bills that vary, enter the usual amount; you can change a single date later." : undefined}>
              {(p) => <MoneyInput {...p} value={s.amount} onValueChange={(v) => set("amount", v)} />}
            </Field>
            <Field label={s.type === "TRANSFER" ? "From account" : s.type === "INCOME" ? "Into account" : "Paid from"} error={errors.accountId} required>
              {(p) => <AccountSelect control={p} value={s.accountId} onChange={(v) => set("accountId", v)} />}
            </Field>
            {s.type === "TRANSFER" ? (
              <Field label="To account" error={errors.destinationAccountId} required>
                {(p) => <AccountSelect control={p} value={s.destinationAccountId} onChange={(v) => set("destinationAccountId", v)} exclude={s.accountId} />}
              </Field>
            ) : (
              <Field label="Category" error={errors.categoryId} required>
                {(p) => <CategorySelect control={p} kind={s.type === "INCOME" ? "INCOME" : "EXPENSE"} value={s.categoryId} onChange={(v) => set("categoryId", v)} />}
              </Field>
            )}
            <Field label="Repeats" error={errors.frequency} required>
              {(p) => (
                <div className="flex gap-2">
                  <span className="flex h-10 items-center text-sm text-muted-foreground">Every</span>
                  <Input {...p} aria-label="Interval" className="w-16" inputMode="numeric" value={s.interval} onChange={(e) => set("interval", e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  <Select aria-label="Frequency" value={s.frequency} onChange={(e) => set("frequency", e.target.value as RecurringFormState["frequency"])}>
                    <option value="DAILY">day(s)</option>
                    <option value="WEEKLY">week(s)</option>
                    <option value="MONTHLY">month(s)</option>
                    <option value="YEARLY">year(s)</option>
                  </Select>
                </div>
              )}
            </Field>
            <Field label="Starts / anchor date" error={errors.startDate} required hint="Monthly items repeat on this day (clamped to short months).">
              {(p) => <Input {...p} type="date" value={s.startDate} onChange={(e) => set("startDate", e.target.value)} />}
            </Field>
            <Field label="Ends" optional error={errors.endDate}>
              {(p) => <Input {...p} type="date" value={s.endDate} onChange={(e) => set("endDate", e.target.value)} />}
            </Field>
            <Field label="Remind me" error={errors.reminderDaysBefore}>
              {(p) => (
                <Select {...p} value={s.reminderDaysBefore} onChange={(e) => set("reminderDaysBefore", e.target.value)}>
                  <option value="0">On the day</option>
                  {[1, 2, 3, 5, 7].map((d) => <option key={d} value={String(d)}>{d} day(s) before</option>)}
                </Select>
              )}
            </Field>
            {kind !== "STANDARD" && (
              <Field label="Merchant" optional error={errors.merchant}>
                {(p) => <Input {...p} value={s.merchant} onChange={(e) => set("merchant", e.target.value)} />}
              </Field>
            )}
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <span>
              <span className="font-medium">Record automatically when due</span>
              <span className="block text-xs text-muted-foreground">
                Off: you'll be reminded and mark it paid yourself. On: the transaction is recorded on the due date (use for autopay/debits you trust).
              </span>
            </span>
            <Switch checked={s.autoCreate} onCheckedChange={(c) => { set("autoCreate", c); set("autopay", c); }} aria-label="Record automatically when due" />
          </label>
          <Field label="Notes" optional error={errors.notes}>
            {(p) => <Textarea {...p} rows={2} value={s.notes} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{editing ? "Save changes" : "Add"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mark the outstanding occurrence paid (records a real transaction) or skip it. */
export function useOccurrenceActions() {
  const { addToast } = useToast();
  const settle = useFinanceMutation({
    affects: ["recurring", "transaction"],
    mutationFn: ({ id, date, body }: { id: string; date: string; body: Record<string, unknown> }) =>
      api.post(`/api/recurring/${id}/occurrences/${date}/settle`, body, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: (res) => addToast(res.message ?? "Marked as paid", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  const update = useFinanceMutation({
    affects: ["recurring"],
    mutationFn: ({ id, date, body }: { id: string; date: string; body: Record<string, unknown> }) => api.patch(`/api/recurring/${id}/occurrences/${date}`, body),
    onSuccess: (res) => addToast(res.message ?? "Updated", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  return { settle, update };
}

function RecurringCard({ r, onEdit, onDelete }: { r: RecurringDTO; onEdit: () => void; onDelete: () => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const { settle, update } = useOccurrenceActions();
  const state = STATE_LABEL[r.state];
  const target = r.outstanding?.dueDate ?? (r.state === "DUE_SOON" || r.state === "DUE_TODAY" ? r.nextDueDate : null);
  const changeState = useFinanceMutation({
    affects: ["recurring"],
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/recurring/${r.id}/state`, { ...body, version: r.version }),
    onSuccess: (res) => addToast(res.message ?? "Updated", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <Link href={`/recurring/${r.id}`} className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{r.name}</span>
          <Badge variant={state.variant}>{state.label}</Badge>
          {r.autoCreate && <Badge variant="outline">Auto</Badge>}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {r.categoryName && <Swatch color={r.categoryColor} className="h-2 w-2" />}
          {[describeRecurrence(r.frequency, r.interval), r.categoryName ?? (r.type === "TRANSFER" ? `→ ${r.destinationAccountName}` : null), r.accountName].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {r.outstanding ? `Due ${f.relative(r.outstanding.dueDate)}` : r.nextDueDate ? `Next ${f.relative(r.nextDueDate)}` : "No upcoming date"}
          {r.frequency !== "MONTHLY" || r.interval !== 1 ? ` · ≈ ${f.money(r.monthlyEquivalent)}/month` : ""}
        </span>
      </Link>
      <div className="flex items-center gap-2 sm:justify-end">
        <span className={cn("font-semibold num", r.type === "INCOME" ? "text-inflow" : "")}>{f.money(r.outstanding?.amount ?? r.amount)}</span>
        {target && !r.cancelled && r.active && (
          <>
            <Button size="xs" onClick={() => settle.mutate({ id: r.id, date: target, body: { mode: "create" } })} loading={settle.isPending}>
              <CheckCircle2 aria-hidden="true" /> {r.type === "INCOME" ? "Received" : "Paid"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: r.id, date: target, body: { action: "skip" } })} loading={update.isPending}>
              <SkipForward aria-hidden="true" /> Skip
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`More actions for ${r.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden="true" /> Edit</DropdownMenuItem>
            {!r.cancelled && (r.active ? (
              <DropdownMenuItem onSelect={() => changeState.mutate({ action: "pause" })}><Pause aria-hidden="true" /> Pause</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => changeState.mutate({ action: "resume", missed: "skip" })}><Play aria-hidden="true" /> Resume</DropdownMenuItem>
            ))}
            {!r.cancelled && <DropdownMenuItem onSelect={() => setConfirmCancel(true)}><XCircle aria-hidden="true" /> Cancel {r.kind === "SUBSCRIPTION" ? "subscription" : ""}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}><Trash2 aria-hidden="true" /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel ${r.name}?`}
        description="No further dates will be scheduled. Past records stay. You can't undo a cancellation, but you can create it again."
        confirmLabel="Cancel it"
        onConfirm={() => changeState.mutateAsync({ action: "cancel" })}
      />
    </div>
  );
}

export function RecurringManager({ kind, title }: { kind: Kind | "ALL"; title?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const f = useFormat();
  const { addToast } = useToast();
  const q = useRecurring(kind === "ALL" ? undefined : kind);
  const [view, setView] = React.useState<"active" | "inactive">("active");
  const [typeFilter, setTypeFilter] = React.useState(params.get("type") ?? "");
  const newParam = params.get("new");
  const [editing, setEditing] = React.useState<RecurringDTO | null>(null);
  const [creating, setCreating] = React.useState<boolean>(!!newParam);
  const [deleting, setDeleting] = React.useState<RecurringDTO | null>(null);
  const createKind: Kind = kind === "ALL" ? "STANDARD" : kind;

  const all = q.data ?? [];
  const active = all.filter((r) => !r.cancelled && r.state !== "ENDED");
  const inactive = all.filter((r) => r.cancelled || r.state === "ENDED");
  const list = (view === "active" ? active : inactive).filter((r) => !typeFilter || r.type === typeFilter);
  const outflow = active.filter((r) => r.type === "EXPENSE" && r.active);
  const monthly = outflow.reduce((s, r) => s + r.monthlyEquivalent, 0);
  const dueSoon = active.filter((r) => ["DUE_SOON", "DUE_TODAY", "OVERDUE"].includes(r.state)).length;

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/recurring/${deleting.id}`);
      addToast("Deleted — recorded transactions were kept", "success");
      setDeleting(null);
      await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={kind === "SUBSCRIPTION" ? "Subscriptions per month" : "Committed per month"} value={f.money(monthly)} hint={`${f.money(monthly * 12)} a year`} />
        <StatTile label="Active" value={active.filter((r) => r.active).length} hint={`${active.filter((r) => !r.active).length} paused`} />
        <StatTile label="Need attention" value={dueSoon} hint="Due soon, today or overdue" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Segmented label="Show" value={view} onChange={setView} options={[{ value: "active", label: `Active (${active.length})` }, { value: "inactive", label: `Ended & cancelled (${inactive.length})` }]} />
          {kind === "ALL" && (
            <Select aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto">
              <option value="">All types</option>
              <option value="EXPENSE">Expenses</option>
              <option value="INCOME">Income</option>
              <option value="TRANSFER">Transfers</option>
            </Select>
          )}
        </div>
        <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Add {NOUN[createKind]}</Button>
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={view === "active" ? `No ${NOUN[createKind]}s yet` : "Nothing here"}
          description={
            view === "active"
              ? kind === "SUBSCRIPTION"
                ? "Track streaming, software and memberships to see what they cost you each month and year."
                : kind === "BILL"
                  ? "Add rent, utilities, phone and card payments to get reminders and see them in your cash-flow forecast."
                  : "Set up salary, rent, SIPs or anything else that repeats."
              : "Cancelled and ended items appear here."
          }
          action={view === "active" ? <Button onClick={() => setCreating(true)}>Add {NOUN[createKind]}</Button> : undefined}
        />
      ) : (
        <Card className="divide-y overflow-hidden">
          {list.map((r) => <RecurringCard key={r.id} r={r} onEdit={() => setEditing(r)} onDelete={() => setDeleting(r)} />)}
        </Card>
      )}
      <RecurringFormDialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          if (!o && newParam) router.replace(window.location.pathname);
        }}
        kind={createKind}
        defaults={newParam === "INCOME" ? { type: "INCOME" } : undefined}
      />
      <RecurringFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} kind={editing?.kind ?? createKind} existing={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Future dates are removed. Transactions already recorded from it stay in your history."
        onConfirm={remove}
      />
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}
