"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { Amount } from "@/components/app/amount";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { useFormat } from "@/components/providers/app-context";
import { api, ApiClientError, newIdempotencyKey } from "@/lib/client/api";
import { useFinanceMutation, useInvalidate } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { ACCOUNT_TYPES, isLiabilityType } from "@/lib/constants";
import { accountAdjustmentSchema, accountCreateSchema, accountUpdateSchema, reconciliationStartSchema } from "@/lib/validation/schemas";
import { accountFormFromDTO, buildAccountCreateBody, buildAccountUpdateBody, emptyAccountForm, type AccountFormState } from "@/lib/forms/account";
import type { AccountDTO } from "@/server/services/account.service";
import type { ReconciliationWorkspace } from "@/server/services/reconciliation.service";
import type { AccountType } from "@/types";

export function AccountFormDialog({ open, onOpenChange, account, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; account?: AccountDTO | null; onSaved?: (a: AccountDTO) => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const editing = !!account;
  const [s, setS] = React.useState<AccountFormState>(() => (account ? accountFormFromDTO(account) : emptyAccountForm(f.today())));
  const { errors, formError, validate, handleError, clear, clearField } = useFormErrors();
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (open) {
      setS(account ? accountFormFromDTO(account) : emptyAccountForm(f.today()));
      clear();
      key.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);
  const set = <K extends keyof AccountFormState>(k: K, v: AccountFormState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    clearField(k as string);
  };
  const liability = isLiabilityType(s.type);
  const m = useFinanceMutation({
    affects: ["account"],
    mutationFn: async (body: unknown) =>
      editing ? (await api.patch<AccountDTO>(`/api/accounts/${account!.id}`, body)).data : (await api.post<AccountDTO>("/api/accounts", body, { idempotencyKey: key.current })).data,
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = editing ? buildAccountUpdateBody(s, account!.version, { canEditOpening: true }) : buildAccountCreateBody(s);
    if (!validate(editing ? accountUpdateSchema : accountCreateSchema, body)) return;
    try {
      const saved = await m.mutateAsync(body);
      addToast(editing ? "Account updated" : "Account added", "success");
      onSaved?.(saved);
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
          <DialogTitle>{editing ? `Edit ${account!.name}` : "Add an account"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changing the opening balance recalculates the balance from the ledger. To match a statement, use Adjust balance instead."
              : "The opening balance is what the account held (or owed) on the opening date. Everything after that is calculated from your transactions."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name} required>
              {(p) => <Input {...p} value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. HDFC Savings" data-autofocus />}
            </Field>
            <Field label="Type" error={errors.type} required>
              {(p) => (
                <Select {...p} value={s.type} onChange={(e) => set("type", e.target.value as AccountType)}>
                  <optgroup label="What you own">
                    {ACCOUNT_TYPES.filter((t) => t.group === "ASSET").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </optgroup>
                  <optgroup label="What you owe">
                    {ACCOUNT_TYPES.filter((t) => t.group === "LIABILITY").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </optgroup>
                </Select>
              )}
            </Field>
            <Field label={liability ? "Amount owed on the opening date" : "Opening balance"} error={errors.openingBalance} hint={liability ? "Enter what you owe as a positive number." : undefined}>
              {(p) => <MoneyInput {...p} value={s.openingAmount} onValueChange={(v) => set("openingAmount", v)} allowNegative={!liability} />}
            </Field>
            <Field label="Opening date" error={errors.openingDate}>
              {(p) => <Input {...p} type="date" value={s.openingDate} onChange={(e) => set("openingDate", e.target.value)} />}
            </Field>
            <Field label="Institution" optional error={errors.institution}>
              {(p) => <Input {...p} value={s.institution} onChange={(e) => set("institution", e.target.value)} />}
            </Field>
            {s.type === "CREDIT_CARD" && (
              <>
                <Field label="Credit limit" optional error={errors.creditLimit}>
                  {(p) => <MoneyInput {...p} value={s.creditLimit} onValueChange={(v) => set("creditLimit", v)} />}
                </Field>
                <Field label="Statement day" optional error={errors.statementDay} hint="Day of the month the statement is generated.">
                  {(p) => <Input {...p} inputMode="numeric" value={s.statementDay} onChange={(e) => set("statementDay", e.target.value.replace(/\D/g, "").slice(0, 2))} />}
                </Field>
                <Field label="Payment due day" optional error={errors.paymentDueDay}>
                  {(p) => <Input {...p} inputMode="numeric" value={s.paymentDueDay} onChange={(e) => set("paymentDueDay", e.target.value.replace(/\D/g, "").slice(0, 2))} />}
                </Field>
                <Field label="Last 4 digits" optional error={errors.maskedNumber} hint="Only the last four digits are stored.">
                  {(p) => <Input {...p} inputMode="numeric" value={s.maskedNumber} onChange={(e) => set("maskedNumber", e.target.value.replace(/\D/g, "").slice(0, 4))} />}
                </Field>
              </>
            )}
          </div>
          <Field label="Notes" optional error={errors.notes}>
            {(p) => <Textarea {...p} rows={2} value={s.notes} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <span>
              <span className="font-medium">Include in net worth</span>
              <span className="block text-xs text-muted-foreground">Turn off for accounts you track but don't own (e.g. a shared account).</span>
            </span>
            <Switch checked={s.includeInNetWorth} onCheckedChange={(c) => set("includeInNetWorth", c)} aria-label="Include in net worth" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{editing ? "Save changes" : "Add account"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustBalanceDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account: AccountDTO }) {
  const f = useFormat();
  const { addToast } = useToast();
  const liability = account.group === "LIABILITY";
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(f.today());
  const [reason, setReason] = React.useState("");
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (open) {
      setAmount(String(liability ? Math.max(0, -account.balance) : account.balance));
      setDate(f.today());
      setReason("");
      clear();
      key.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useFinanceMutation({
    affects: ["account", "transaction"],
    mutationFn: (body: unknown) => api.post<{ adjusted: boolean }>(`/api/accounts/${account.id}/adjust`, body, { idempotencyKey: key.current }),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const n = Number(amount.replace(/,/g, ""));
    const body = { targetBalance: liability ? -Math.abs(n) : n, date, reason: reason.trim() };
    if (!validate(accountAdjustmentSchema, body)) return;
    try {
      const res = await m.mutateAsync(body);
      addToast(res.message ?? "Balance adjusted", "success");
      onOpenChange(false);
    } catch (err) {
      handleError(err);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Adjust balance</DialogTitle>
          <DialogDescription>
            Records a dated adjustment so {account.name} matches reality. History isn't rewritten, and adjustments never count as income or spending.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <p className="text-sm">Current balance: <Amount value={account.balance} className="font-medium" /></p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={liability ? "Actual amount owed" : "Actual balance"} error={errors.targetBalance} required>
              {(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} allowNegative={!liability} />}
            </Field>
            <Field label="As of" error={errors.date} required>
              {(p) => <Input {...p} type="date" value={date} max={f.today()} onChange={(e) => setDate(e.target.value)} />}
            </Field>
          </div>
          <Field label="Reason" error={errors.reason} required>
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cash count, bank charges not recorded" />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>Record adjustment</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Statement reconciliation: enter the statement date and balance, compare with
 * the ledger as of that date, fix records, then complete (or explicitly accept
 * an adjustment for the remaining difference).
 */
export function ReconcileDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account: AccountDTO }) {
  const f = useFormat();
  const { addToast } = useToast();
  const invalidate = useInvalidate();
  const liability = account.group === "LIABILITY";
  const [date, setDate] = React.useState(f.today());
  const [amount, setAmount] = React.useState("");
  const [ws, setWs] = React.useState<ReconciliationWorkspace | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [accept, setAccept] = React.useState(false);
  const { errors, formError, validate, handleError, clear, setFormError } = useFormErrors();
  React.useEffect(() => {
    if (open) {
      setWs(null);
      setAmount("");
      setAccept(false);
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const n = Number(amount.replace(/,/g, ""));
    const body = { accountId: account.id, statementDate: date, statementBalance: liability ? -Math.abs(n) : n };
    if (!validate(reconciliationStartSchema, body)) return;
    setBusy(true);
    try {
      setWs((await api.post<ReconciliationWorkspace>("/api/reconciliations", body)).data);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => ws && setWs(await api.get<ReconciliationWorkspace>(`/api/reconciliations/${ws.id}`));
  const complete = async () => {
    if (!ws) return;
    setBusy(true);
    try {
      await api.post(`/api/reconciliations/${ws.id}/complete`, { createAdjustment: accept, reason: accept ? "Unexplained statement difference" : undefined });
      await invalidate("account", "transaction");
      addToast("Reconciliation complete", "success");
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "DIFFERENCE_REMAINS") setFormError(err.message);
      else handleError(err);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (ws && ws.status !== "COMPLETED") await api.delete(`/api/reconciliations/${ws.id}`).catch(() => undefined);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : void cancel())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Reconcile {account.name}</DialogTitle>
          <DialogDescription>Compare the app with your bank or card statement. Nothing changes until you complete.</DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        {!ws ? (
          <form onSubmit={start} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Statement date" error={errors.statementDate} required>
                {(p) => <Input {...p} type="date" value={date} max={f.today()} onChange={(e) => setDate(e.target.value)} />}
              </Field>
              <Field label={liability ? "Statement amount owed" : "Statement closing balance"} error={errors.statementBalance} required>
                {(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} allowNegative={!liability} />}
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Compare</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Statement</dt><dd className="font-semibold num">{f.money(ws.statementBalance)}</dd></div>
              <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">App on {f.dateShort(ws.statementDate)}</dt><dd className="font-semibold num">{f.money(ws.appBalance)}</dd></div>
              <div className={`rounded-lg border p-3 ${ws.difference === 0 ? "border-inflow/40 bg-inflow-soft" : "border-warning/40 bg-warning-soft"}`}>
                <dt className="text-xs text-muted-foreground">Difference</dt>
                <dd className="font-semibold num">{f.money(ws.difference)}</dd>
              </div>
            </dl>
            {ws.difference === 0 ? (
              <p className="text-sm">Everything matches. Completing marks the {ws.unreconciled.length} record(s) up to {f.date(ws.statementDate)} as reconciled.</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Look for missing, duplicated or mis-dated records below (open another tab to fix them, then refresh). If you can't find the cause you can record an adjustment.
              </p>
            )}
            <div className="max-h-72 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
              {ws.unreconciled.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No unreconciled records up to this date.</p>
              ) : (
                ws.unreconciled.map((t) => <TransactionRow key={t.id} t={t} />)
              )}
            </div>
            {ws.difference !== 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                Record a {f.money(Math.abs(ws.difference))} balance adjustment dated {f.date(ws.statementDate)} for the unexplained difference
              </label>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => void cancel()}>Cancel</Button>
              <Button variant="outline" onClick={() => void refresh()}>Refresh</Button>
              <Button onClick={() => void complete()} loading={busy} disabled={ws.difference !== 0 && !accept}>
                Complete reconciliation
              </Button>
            </DialogFooter>
            {ws.previous && <Badge variant="secondary">Last reconciled {f.date(ws.previous.statementDate)}</Badge>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
