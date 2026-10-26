"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, FileText, Lightbulb, Paperclip, Pencil, RotateCcw, Send, Trash2, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Amount } from "@/components/app/amount";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { AccountSelect } from "@/components/app/pickers";
import { ErrorState } from "@/components/app/states";
import { Swatch } from "@/components/app/kit";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { qk, useFinanceMutation, useInvalidate } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { useTransaction } from "@/lib/client/hooks";
import { refundCreateSchema } from "@/lib/validation/schemas";
import type { TransactionDTO } from "@/server/services/transaction.types";
import type { AttachmentDTO } from "@/server/services/attachment.service";
import { transactionDirection, transactionTitle } from "./transaction-row";
import { useTransactionDialog } from "./transaction-dialog";

/** Deletes with an Undo action (restore brings back the row AND its balance effects). */
export function useDeleteWithUndo() {
  const { addToast } = useToast();
  const invalidate = useInvalidate();
  return React.useCallback(
    async (t: Pick<TransactionDTO, "id" | "version" | "reconciled" | "refundCount">, opts: { withRefunds?: boolean; confirmReconciledChange?: boolean } = {}) => {
      const res = await api.delete<{ id: string; deletedRefundIds: string[]; warnings: string[] }>(`/api/transactions/${t.id}`, {
        query: { version: t.version, withRefunds: opts.withRefunds, confirmReconciledChange: opts.confirmReconciledChange },
      });
      await invalidate("transaction");
      for (const w of res.data.warnings) addToast(w, "info");
      addToast(res.message ?? "Transaction deleted", "success", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              for (const id of [...res.data.deletedRefundIds, t.id].reverse()) await api.post(`/api/transactions/${id}/restore`);
              await invalidate("transaction");
              addToast("Restored", "success");
            } catch (e) {
              addToast(errorMessage(e), "error");
            }
          },
        },
      });
    },
    [addToast, invalidate]
  );
}

function RefundForm({ t, onDone }: { t: TransactionDTO; onDone: () => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const remaining = Math.max(0, t.amount - t.refundedAmount);
  const [amount, setAmount] = React.useState(String(remaining));
  const [date, setDate] = React.useState(f.today());
  const [accountId, setAccountId] = React.useState(t.accountId ?? "");
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const key = React.useRef(newIdempotencyKey());
  const m = useFinanceMutation({
    affects: ["transaction"],
    mutationFn: (body: unknown) => api.post(`/api/transactions/${t.id}/refunds`, body, { idempotencyKey: key.current }),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { amount: amount.replace(/,/g, ""), transactionDate: date, accountId };
    if (!validate(refundCreateSchema, body)) return;
    try {
      await m.mutateAsync(body);
      addToast("Refund recorded", "success");
      onDone();
    } catch (err) {
      if (!(err instanceof ApiClientError && err.uncertain)) key.current = newIdempotencyKey();
      handleError(err);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-3" noValidate>
      <p className="text-sm font-medium">Record a refund</p>
      <p className="text-xs text-muted-foreground">Up to {f.money(remaining)} can still be refunded. The refund reduces net spending on the refund's date.</p>
      <FormError message={formError} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount" error={errors.amount} required>
          {(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}
        </Field>
        <Field label="Date" error={errors.transactionDate} required>
          {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Received in" error={errors.accountId} required>
          {(p) => <AccountSelect control={p} value={accountId} onChange={setAccountId} />}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" loading={m.isPending}>Save refund</Button>
      </div>
    </form>
  );
}

function Attachments({ t }: { t: TransactionDTO }) {
  const { addToast } = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: qk("transactions", "attachments", t.id),
    queryFn: () => api.get<AttachmentDTO[]>(`/api/transactions/${t.id}/attachments`),
  });
  const [uploading, setUploading] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      addToast("Files can be at most 5 MB", "error");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/transactions/${t.id}/attachments`, { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed");
      addToast("Attachment added", "success");
      await Promise.all([q.refetch(), invalidate("transaction")]);
    } catch (e) {
      addToast(errorMessage(e), "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async (id: string) => {
    try {
      await api.delete(`/api/attachments/${id}`);
      await Promise.all([q.refetch(), invalidate("transaction")]);
      addToast("Attachment removed", "success");
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Receipts & documents</h3>
        <Button type="button" variant="outline" size="xs" onClick={() => input.current?.click()} loading={uploading}>
          <Upload aria-hidden="true" /> Attach
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          aria-label="Attach a receipt"
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
        />
      </div>
      {q.isLoading ? (
        <Skeleton className="h-10" />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or PDF up to 5 MB. Files are private to you.</p>
      ) : (
        <ul className="space-y-1.5">
          {q.data!.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
              {a.contentType === "application/pdf" ? <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                {a.fileName}
              </a>
              <span className="text-xs text-muted-foreground num">{Math.ceil(a.size / 1024)} KB</span>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => void remove(a.id)} aria-label={`Remove ${a.fileName}`}>
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Explanation({ id }: { id: string }) {
  const q = useQuery({
    queryKey: qk("transactions", "explain", id),
    queryFn: () => api.get<{ facts: { label: string; value: string }[] }>(`/api/transactions/${id}/explain`),
  });
  if (q.isLoading) return <Skeleton className="h-16" />;
  if (q.isError) return <p className="text-xs text-muted-foreground">{errorMessage(q.error)}</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {q.data!.facts.map((fct) => (
        <div key={fct.label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{fct.label}</dt>
          <dd className="num">{fct.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TransactionDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }) {
  const q = useTransaction(id);
  const f = useFormat();
  const { addToast } = useToast();
  const txDialog = useTransactionDialog();
  const deleteWithUndo = useDeleteWithUndo();
  const invalidate = useInvalidate();
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [explain, setExplain] = React.useState(false);
  const [confirm, setConfirm] = React.useState<null | "delete" | "reconciled">(null);
  const [withRefunds, setWithRefunds] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  React.useEffect(() => {
    setRefundOpen(false);
    setExplain(false);
    setConfirm(null);
    setWithRefunds(false);
  }, [id]);
  const t = q.data;

  const doDelete = async (confirmReconciledChange = false) => {
    if (!t) return;
    try {
      await deleteWithUndo(t, { withRefunds, confirmReconciledChange });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "RECONCILED_CHANGE") {
        setConfirm("reconciled");
        return;
      }
      addToast(errorMessage(e), "error");
    }
  };

  const post = async () => {
    if (!t) return;
    setPosting(true);
    try {
      await api.post(`/api/transactions/${t.id}/post`, { version: t.version, transactionDate: t.transactionDate > f.today() ? f.today() : undefined });
      await invalidate("transaction");
      addToast("Posted — balances updated", "success");
    } catch (e) {
      addToast(errorMessage(e), "error");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open={id !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {q.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24" />
          </div>
        ) : q.isError || !t ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {transactionTitle(t)}
                {t.status === "PLANNED" && <Badge variant="warning">Planned</Badge>}
                {t.reconciled && <Badge variant="secondary">Reconciled</Badge>}
              </DialogTitle>
              <DialogDescription>
                {t.type.charAt(0) + t.type.slice(1).toLowerCase()} on {f.date(t.transactionDate)}
                {t.status === "PLANNED" ? " — doesn't affect balances until posted" : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <Amount value={t.amount} direction={transactionDirection(t)} className="text-3xl font-semibold" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {t.type === "TRANSFER" ? (
                  <>
                    <Row label="From" value={t.account?.name ?? "—"} />
                    <Row label="To" value={t.destinationAccount?.name ?? "—"} />
                  </>
                ) : (
                  <Row label={t.type === "INCOME" || t.type === "REFUND" ? "Into" : "From"} value={t.account?.name ?? t.destinationAccount?.name ?? "—"} />
                )}
                {!t.isSplit && t.type !== "TRANSFER" && (
                  <Row label="Category" value={t.category ? <span className="inline-flex items-center gap-1.5"><Swatch color={t.category.color} />{t.category.name}</span> : "Uncategorised"} />
                )}
                {t.merchant && <Row label="Merchant" value={t.merchantName && t.merchantName !== t.merchant ? `${t.merchantName} (${t.merchant})` : t.merchant} />}
                {t.description && <Row label="Description" value={t.description} />}
                {t.paymentMethod && <Row label="Payment method" value={t.paymentMethod} />}
                {t.tags.length > 0 && <Row label="Tags" value={t.tags.map((x) => `#${x}`).join(" ")} />}
                {t.notes && <Row label="Notes" value={t.notes} wide />}
              </dl>

              {t.isSplit && (
                <section>
                  <h3 className="mb-2 text-sm font-medium">Split across categories</h3>
                  <ul className="divide-y rounded-lg border">
                    {t.splits.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <Swatch color={s.categoryColor} />
                        <span className="flex-1">{s.categoryName}{s.note ? <span className="text-muted-foreground"> — {s.note}</span> : null}</span>
                        <span className="num">{f.money(s.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {t.type === "EXPENSE" && t.status === "POSTED" && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Refunds</h3>
                    {!refundOpen && t.refundedAmount < t.amount && (
                      <Button variant="outline" size="xs" onClick={() => setRefundOpen(true)}>
                        <RotateCcw aria-hidden="true" /> Record refund
                      </Button>
                    )}
                  </div>
                  {t.refundCount > 0 ? (
                    <p className="text-sm">
                      {f.money(t.refundedAmount)} refunded in {t.refundCount} refund(s); net cost {f.money(t.amount - t.refundedAmount)}.
                    </p>
                  ) : (
                    !refundOpen && <p className="text-xs text-muted-foreground">No refunds.</p>
                  )}
                  {refundOpen && <RefundForm t={t} onDone={() => setRefundOpen(false)} />}
                </section>
              )}

              <Attachments t={t} />

              {(t.type === "EXPENSE" || t.type === "INCOME") && t.status === "POSTED" && (
                <section>
                  <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" onClick={() => setExplain((e) => !e)} aria-expanded={explain}>
                    <Lightbulb className="h-4 w-4" aria-hidden="true" /> Is this amount typical?
                  </button>
                  {explain && <div className="mt-2"><Explanation id={t.id} /></div>}
                </section>
              )}
            </div>
            <DialogFooter className="flex-wrap">
              <Button variant="ghost" className="text-outflow hover:text-outflow sm:mr-auto" onClick={() => setConfirm("delete")}>
                <Trash2 aria-hidden="true" /> Delete
              </Button>
              {t.status === "PLANNED" && (
                <Button variant="outline" onClick={post} loading={posting}>
                  <Send aria-hidden="true" /> Post now
                </Button>
              )}
              {t.type !== "ADJUSTMENT" && t.type !== "REFUND" && (
                <Button variant="outline" onClick={() => { onOpenChange(false); txDialog.openDuplicate(t.id); }}>
                  <Copy aria-hidden="true" /> Duplicate
                </Button>
              )}
              <Button onClick={() => { onOpenChange(false); txDialog.openEdit(t.id); }}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            </DialogFooter>
            <ConfirmDialog
              open={confirm === "delete"}
              onOpenChange={(o) => !o && setConfirm(null)}
              title="Delete this transaction?"
              description={
                t.refundCount > 0
                  ? "This purchase has refunds. Choose whether to delete them too; otherwise the purchase can't be deleted while refunds point at it."
                  : "Balances, budgets and reports update immediately. You can undo from the notification."
              }
              onConfirm={() => doDelete(false)}
            >
              {t.refundCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withRefunds} onChange={(e) => setWithRefunds(e.target.checked)} className="h-4 w-4" />
                  Also delete its {t.refundCount} refund(s)
                </label>
              )}
            </ConfirmDialog>
            <ConfirmDialog
              open={confirm === "reconciled"}
              onOpenChange={(o) => !o && setConfirm(null)}
              title="This is part of a reconciled statement"
              description="Deleting it reopens that reconciliation, and you'll need to reconcile the account again."
              confirmLabel="Delete and reopen"
              onConfirm={() => doDelete(true)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
