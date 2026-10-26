"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { AccountSelect, CategorySelect } from "@/components/app/pickers";
import { TagInput } from "@/components/app/tag-input";
import { useFormat, useUser } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useFormErrors, useIdempotencyKey } from "@/lib/client/form";
import { useAccounts } from "@/lib/client/hooks";
import { PAYMENT_METHODS } from "@/lib/constants";
import { toMinor, fromMinor } from "@/lib/utils/money";
import { transactionCreateSchema, transactionUpdateSchema } from "@/lib/validation/schemas";
import {
  buildTransactionCreateBody,
  buildTransactionUpdateBody,
  switchTransactionType,
  type EntryType,
  type TransactionFormState,
} from "@/lib/forms/transaction";
import { cn } from "@/lib/utils/cn";
import type { TransactionDTO } from "@/server/services/transaction.types";

const TYPES: { value: EntryType; label: string; icon: React.ElementType }[] = [
  { value: "EXPENSE", label: "Expense", icon: ArrowUpRight },
  { value: "INCOME", label: "Income", icon: ArrowDownLeft },
  { value: "TRANSFER", label: "Transfer", icon: ArrowRightLeft },
];

function TypeSwitch({ value, onChange, disabled }: { value: EntryType; onChange: (t: EntryType) => void; disabled?: boolean }) {
  return (
    <div
      role="radiogroup"
      aria-label="Transaction type"
      className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
      onKeyDown={(e) => {
        const i = TYPES.findIndex((t) => t.value === value);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const next = TYPES[(i + (e.key === "ArrowRight" ? 1 : TYPES.length - 1)) % TYPES.length]!;
          onChange(next.value);
          (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
        }
      }}
    >
      {TYPES.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            data-value={t.value}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(t.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden="true" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const LAST_KEY = (userId: string) => `em-last-entry:${userId}`;

export function rememberLastEntry(userId: string, s: TransactionFormState) {
  try {
    const prev = JSON.parse(localStorage.getItem(LAST_KEY(userId)) ?? "{}");
    localStorage.setItem(LAST_KEY(userId), JSON.stringify({ ...prev, accountId: s.accountId, [`category:${s.type}`]: s.categoryId }));
  } catch {
    /* storage unavailable */
  }
}

export function recallLastEntry(userId: string): { accountId?: string; category?: Record<string, string> } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_KEY(userId)) ?? "{}");
    return {
      accountId: raw.accountId,
      category: { EXPENSE: raw["category:EXPENSE"], INCOME: raw["category:INCOME"] },
    };
  } catch {
    return {};
  }
}

/**
 * Split editor: one purchase, several categories. Lines must add up to the
 * amount exactly; the remainder is shown live. Budgets and analytics count each
 * line in its own category (never the full amount twice).
 */
function SplitEditor({ s, setS, errors }: { s: TransactionFormState; setS: (next: TransactionFormState) => void; errors: Record<string, string> }) {
  const f = useFormat();
  const total = toMinor(Number(s.amount.replace(/,/g, "")) || 0);
  const allocated = s.splits.reduce((a, l) => a + toMinor(Number(l.amount.replace(/,/g, "")) || 0), 0);
  const remaining = total - allocated;
  const kind = s.type === "INCOME" ? "INCOME" : "EXPENSE";
  const update = (i: number, patch: Partial<TransactionFormState["splits"][number]>) =>
    setS({ ...s, splits: s.splits.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  if (s.splits.length === 0) {
    return (
      <button
        type="button"
        className="self-start rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          setS({
            ...s,
            splits: [
              { categoryId: s.categoryId, amount: s.amount, note: "" },
              { categoryId: "", amount: "", note: "" },
            ],
          })
        }
      >
        Split across categories
      </button>
    );
  }
  const splitError = errors.splits ?? Object.entries(errors).find(([k]) => k.startsWith("splits."))?.[1];
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Split</legend>
      {s.splits.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_7.5rem_auto] items-center gap-2">
          <CategorySelect value={l.categoryId} onChange={(v) => update(i, { categoryId: v })} kind={kind} control={{ id: `split-cat-${i}`, "aria-invalid": errors[`splits.${i}.categoryId`] ? true : undefined }} />
          <MoneyInput aria-label={`Amount for line ${i + 1}`} value={l.amount} onValueChange={(v) => update(i, { amount: v })} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove line ${i + 1}`}
            onClick={() => {
              const rest = s.splits.filter((_, j) => j !== i);
              // One line left means it's no longer a split.
              setS(rest.length < 2 ? { ...s, splits: [], categoryId: rest[0]?.categoryId ?? s.categoryId } : { ...s, splits: rest });
            }}
          >
            ×
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setS({ ...s, splits: [...s.splits, { categoryId: "", amount: remaining > 0 ? String(fromMinor(remaining)) : "", note: "" }] })} disabled={s.splits.length >= 20}>
          Add line
        </button>
        <span className={remaining === 0 ? "text-inflow" : "text-warning"} aria-live="polite">
          {remaining === 0 ? "Adds up to the total" : remaining > 0 ? `${f.money(fromMinor(remaining))} left to allocate` : `${f.money(fromMinor(-remaining))} more than the total`}
        </span>
      </div>
      {splitError && <p className="text-xs font-medium text-outflow" role="alert">{splitError}</p>}
    </fieldset>
  );
}

export interface TransactionFormProps {
  mode: "create" | "edit" | "duplicate";
  initial: TransactionFormState;
  /** Edit mode: the record being edited. */
  existing?: Pick<TransactionDTO, "id" | "version" | "status" | "type">;
  lockType?: boolean;
  onSaved: (tx: TransactionDTO) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onReloadRequested?: () => void;
}

export function TransactionForm({ mode, initial, existing, lockType, onSaved, onCancel, onDirtyChange, onReloadRequested }: TransactionFormProps) {
  const f = useFormat();
  const user = useUser();
  const { addToast } = useToast();
  const [s, setS] = React.useState<TransactionFormState>(initial);
  const [moreOpen, setMoreOpen] = React.useState(!!(initial.notes || initial.tags.length || initial.paymentMethod));
  const { errors, formError, clearField, validate, handleError, clear } = useFormErrors();
  const idem = useIdempotencyKey();
  const accounts = useAccounts({ includeArchived: true });
  const amountRef = React.useRef<HTMLInputElement>(null);

  const dirty = React.useMemo(() => JSON.stringify(s) !== JSON.stringify(initial), [s, initial]);
  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const set = <K extends keyof TransactionFormState>(key: K, value: TransactionFormState[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    clearField(key as string);
    idem.rotate();
  };

  const today = f.today();
  const isFuture = s.transactionDate > today;
  const effectiveStatus = s.status === "AUTO" ? (isFuture ? "PLANNED" : "POSTED") : s.status;

  // Balance-effect preview (client-side estimate from current balances).
  const preview = React.useMemo(() => {
    const amount = Number(s.amount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0 || effectiveStatus !== "POSTED") return [];
    const list = accounts.data?.accounts ?? [];
    const rows: { name: string; before: number; after: number }[] = [];
    const bump = (id: string, delta: number) => {
      const a = list.find((x) => x.id === id);
      if (!a) return;
      // When editing, the old effect is already in the balance: preview only new entries.
      rows.push({ name: a.name, before: a.balance, after: fromMinor(toMinor(a.balance) + toMinor(delta)) });
    };
    if (mode === "edit") return [];
    if (s.type === "EXPENSE") bump(s.accountId, -amount);
    if (s.type === "INCOME") bump(s.accountId, amount);
    if (s.type === "TRANSFER") {
      bump(s.accountId, -amount);
      bump(s.destinationAccountId, amount);
    }
    return rows;
  }, [s, accounts.data, effectiveStatus, mode]);

  const mutation = useFinanceMutation<TransactionDTO, TransactionFormState>({
    affects: ["transaction"],
    mutationFn: async (state) => {
      if (mode === "edit" && existing) {
        const res = await api.patch<TransactionDTO>(`/api/transactions/${existing.id}`, buildTransactionUpdateBody(state, existing.version));
        return res.data;
      }
      const res = await api.post<TransactionDTO>("/api/transactions", buildTransactionCreateBody(state), { idempotencyKey: idem.current() });
      return res.data;
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const ok =
      mode === "edit" && existing
        ? validate(transactionUpdateSchema, buildTransactionUpdateBody(s, existing.version)) && validate(transactionCreateSchema, buildTransactionCreateBody(s))
        : validate(transactionCreateSchema, buildTransactionCreateBody(s));
    if (!ok) return;
    try {
      const saved = await mutation.mutateAsync(s);
      idem.rotate();
      rememberLastEntry(user.id, s);
      addToast(
        mode === "edit"
          ? "Transaction updated"
          : saved.status === "PLANNED"
            ? "Saved as planned — it won't change balances until you post it"
            : s.type === "TRANSFER"
              ? "Transfer saved"
              : s.type === "INCOME"
                ? "Income saved"
                : "Expense saved",
        "success"
      );
      onSaved(saved);
    } catch (error) {
      idem.afterError(error);
      handleError(error);
    }
  };

  const conflict = formError && /changed elsewhere|was changed/i.test(formError);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      {conflict && onReloadRequested && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={onReloadRequested}>
          <RotateCcw aria-hidden="true" /> Load the latest version
        </Button>
      )}

      {!lockType && <TypeSwitch value={s.type} onChange={(t) => setS((prev) => switchTransactionType(prev, t))} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" error={errors.amount} required>
          {(p) => (
            <MoneyInput
              {...p}
              ref={amountRef}
              value={s.amount}
              onValueChange={(v) => set("amount", v)}
              placeholder="0"
              className="h-11 text-lg font-semibold"
              data-autofocus
            />
          )}
        </Field>
        <Field label="Date" error={errors.transactionDate} required>
          {(p) => <Input {...p} type="date" value={s.transactionDate} onChange={(e) => set("transactionDate", e.target.value)} className="h-11" />}
        </Field>
      </div>

      {s.type === "TRANSFER" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" error={errors.accountId} required>
            {(p) => <AccountSelect control={p} value={s.accountId} onChange={(v) => set("accountId", v)} />}
          </Field>
          <Field label="To" error={errors.destinationAccountId} required hint="Paying a card or loan? Choose it here.">
            {(p) => (
              <AccountSelect control={p} value={s.destinationAccountId} onChange={(v) => set("destinationAccountId", v)} exclude={s.accountId} />
            )}
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {s.splits.length === 0 ? (
              <Field label="Category" error={errors.categoryId} required>
                {(p) => <CategorySelect control={p} value={s.categoryId} onChange={(v) => set("categoryId", v)} kind={s.type === "INCOME" ? "INCOME" : "EXPENSE"} />}
              </Field>
            ) : (
              <div className="flex flex-col justify-end">
                <p className="text-sm font-medium">Category</p>
                <p className="flex h-10 items-center text-sm text-muted-foreground">Split across {s.splits.length} categories</p>
              </div>
            )}
            <Field label={s.type === "INCOME" ? "Received in" : "Paid from"} error={errors.accountId} required>
              {(p) => <AccountSelect control={p} value={s.accountId} onChange={(v) => set("accountId", v)} />}
            </Field>
          </div>
          <SplitEditor s={s} setS={(next) => { setS(next); clearField("splits"); clearField("categoryId"); idem.rotate(); }} errors={errors} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={s.type === "INCOME" ? "From (payer)" : "Merchant"} error={errors.merchant} optional>
          {(p) => <Input {...p} value={s.merchant} onChange={(e) => set("merchant", e.target.value)} placeholder={s.type === "INCOME" ? "e.g. Employer" : "e.g. BigBasket"} maxLength={120} />}
        </Field>
        <Field label="Description" error={errors.description} optional>
          {(p) => <Input {...p} value={s.description} onChange={(e) => set("description", e.target.value)} placeholder="What was it for?" maxLength={240} />}
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setMoreOpen((o) => !o)}
        aria-expanded={moreOpen}
        className="flex items-center gap-1.5 self-start rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", moreOpen && "rotate-180")} aria-hidden="true" />
        {moreOpen ? "Fewer details" : "Payment method, tags and notes"}
      </button>

      {moreOpen && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment method" error={errors.paymentMethod} optional>
            {(p) => (
              <Select {...p} value={s.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                <option value="">Not specified</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tags" error={errors.tags} optional hint="Context such as Travel or Reimbursable">
            {(p) => <TagInput control={p} value={s.tags} onChange={(v) => set("tags", v)} />}
          </Field>
          <Field label="Notes" error={errors.notes} optional className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} value={s.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1200} />}
          </Field>
        </div>
      )}

      {mode !== "edit" && isFuture && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
          <p className="font-medium text-foreground">This date is in the future.</p>
          <p className="text-muted-foreground">
            It will be saved as <strong>planned</strong>: shown in projections, but balances won't change until you post it.
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <Checkbox checked={s.status === "POSTED"} onCheckedChange={(c) => set("status", c ? "POSTED" : "AUTO")} />
            It already happened — record it now
          </label>
        </div>
      )}

      {preview.length > 0 && (
        <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm" aria-live="polite">
          <p className="mb-1 text-xs text-muted-foreground">After saving</p>
          <ul className="space-y-0.5">
            {preview.map((r) => (
              <li key={r.name} className="flex justify-between gap-3">
                <span className="truncate">{r.name}</span>
                <span className="num text-muted-foreground">
                  {f.money(r.before)} → <span className="text-foreground">{f.money(r.after)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} loadingText="Saving…">
          {mode === "edit" ? "Save changes" : s.type === "TRANSFER" ? "Save transfer" : s.type === "INCOME" ? "Save income" : "Save expense"}
        </Button>
      </DialogFooter>
    </form>
  );
}
