"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, CheckCheck, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ErrorState, PageHeader } from "@/components/app/states";
import { Segmented, StatTile } from "@/components/app/kit";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { TimeSeries } from "@/components/charts/charts";
import { AccountFormDialog, AdjustBalanceDialog, ReconcileDialog } from "@/components/accounts/account-dialogs";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { TransactionDetailDialog } from "@/components/transactions/transaction-detail";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useAccount, useAccountHistory, useApiGet, useCardStatement, useTransactions } from "@/lib/client/hooks";
import { accountTypeMeta } from "@/lib/constants";

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const f = useFormat();
  const { addToast } = useToast();
  const tx = useTransactionDialog();
  const q = useAccount(id);
  const [days, setDays] = React.useState("90");
  const history = useAccountHistory(id, Number(days));
  const statement = useCardStatement(id, q.data?.type === "CREDIT_CARD");
  const recs = useApiGet<{ id: string; statementDate: string; statementBalance: number; status: string; hasAdjustment: boolean; reopenReason: string | null }[]>(
    "accounts",
    "/api/reconciliations",
    { accountId: id }
  );
  const [page, setPage] = React.useState(1);
  const list = useTransactions({ accountId: id, page, pageSize: 20 });
  const [dialog, setDialog] = React.useState<null | "edit" | "adjust" | "reconcile" | "delete">(params.get("reconcile") ? "reconcile" : null);
  const [detail, setDetail] = React.useState<string | null>(null);

  const archive = useFinanceMutation({
    affects: ["account"],
    mutationFn: (archived: boolean) => api.patch(`/api/accounts/${id}`, { version: q.data!.version, archived }),
    onSuccess: (res) => addToast(res.message ?? "Saved", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  const remove = async () => {
    try {
      await api.delete(`/api/accounts/${id}`);
      addToast("Account deleted", "success");
      router.replace("/accounts");
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const liability = a.group === "LIABILITY";
  const meta = accountTypeMeta(a.type);
  const series = (history.data ?? []).map((p) => ({ label: f.dateShort(p.date), value: liability ? -p.balance : p.balance }));

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/accounts"><ArrowLeft aria-hidden="true" /> Accounts</Link>
      </Button>
      <PageHeader
        title={a.name}
        description={[meta.label, a.institution, a.card?.maskedNumber ? `•••• ${a.card.maskedNumber}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog("edit")}><Pencil aria-hidden="true" /> Edit</Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("adjust")}><Scale aria-hidden="true" /> Adjust balance</Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("reconcile")}><CheckCheck aria-hidden="true" /> Reconcile</Button>
            <Button size="sm" onClick={() => tx.openCreate({ accountId: a.id })} disabled={a.archived}><Plus aria-hidden="true" /> Add</Button>
          </>
        }
      >
        {a.archived && <Badge variant="secondary" className="mt-1">Archived — hidden from pickers; history and balance still count</Badge>}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={liability ? "Amount owed" : "Balance"} value={f.money(liability ? a.outstanding ?? 0 : a.balance)} emphasis />
        <StatTile label="In this month" value={f.money(a.stats.inflowThisMonth)} />
        <StatTile label="Out this month" value={f.money(a.stats.outflowThisMonth)} />
        <StatTile
          label="Last reconciled"
          value={a.lastReconciledAt ? f.instant(a.lastReconciledAt) : "Never"}
          hint={`${a.stats.transactionCount} posted, ${a.stats.plannedCount} planned`}
        />
      </div>

      {a.card && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Card statement</CardTitle>
            <CardDescription>From your recorded purchases and payments. Interest and fees appear only if you record them.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statement.isLoading ? (
              <Skeleton className="h-16 sm:col-span-4" />
            ) : statement.data ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Statement balance{statement.data.lastStatementDate ? ` (${f.dateShort(statement.data.lastStatementDate)})` : ""}</p>
                  <p className="font-semibold num">{f.money(statement.data.statementBalance)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid since</p>
                  <p className="font-semibold num">{f.money(statement.data.paidSinceStatement)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Still due{statement.data.nextDueDate ? ` by ${f.dateShort(statement.data.nextDueDate)}` : ""}</p>
                  <p className={`font-semibold num ${statement.data.amountDue > 0 ? "text-outflow" : ""}`}>{f.money(statement.data.amountDue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Available credit</p>
                  <p className="font-semibold num">{a.card.availableCredit != null ? f.money(a.card.availableCredit) : "Set a limit"}</p>
                  {a.card.utilization != null && <Progress className="mt-1.5 h-1.5" value={a.card.utilization} tone={a.card.utilization > 75 ? "outflow" : a.card.utilization > 30 ? "warning" : "default"} label={`${a.card.utilization}% used`} />}
                </div>
                {statement.data.amountDue > 0 && (
                  <div className="sm:col-span-4">
                    <Button size="sm" variant="outline" onClick={() => tx.openCreate({ type: "TRANSFER", destinationAccountId: a.id, amount: String(statement.data!.amountDue) })}>
                      Record a payment
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{errorMessage(statement.error)}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{liability ? "Amount owed over time" : "Balance over time"}</CardTitle>
          <Segmented label="Range" size="xs" value={days} onChange={setDays} options={[{ value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "1y" }]} />
        </CardHeader>
        <CardContent>
          {history.isLoading ? <Skeleton className="h-56" /> : <TimeSeries label={`${a.name} daily balance`} data={series} series={[{ key: "value", name: liability ? "Owed" : "Balance", color: "hsl(var(--chart-1))" }]} zeroLine={!liability} />}
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
        <div className="divide-y border-t">
          {list.isLoading ? (
            <Skeleton className="m-4 h-24" />
          ) : (list.data?.items ?? []).length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No transactions in this account yet.</p>
          ) : (
            list.data!.items.map((t) => <TransactionRow key={t.id} t={t} onOpen={(x) => setDetail(x.id)} />)
          )}
        </div>
        {list.data && list.data.totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t p-3">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page} of {list.data.totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= list.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </Card>

      {(recs.data ?? []).length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Reconciliation history</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {recs.data!.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{f.date(r.statementDate)} · statement {f.money(r.statementBalance)}</span>
                  <span className="flex items-center gap-2">
                    {r.hasAdjustment && <Badge variant="warning">With adjustment</Badge>}
                    <Badge variant={r.status === "COMPLETED" ? "inflow" : r.status === "REOPENED" ? "warning" : "secondary"}>
                      {r.status === "COMPLETED" ? "Completed" : r.status === "REOPENED" ? "Reopened" : "In progress"}
                    </Badge>
                  </span>
                  {r.reopenReason && <span className="w-full text-xs text-muted-foreground">{r.reopenReason}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => archive.mutate(!a.archived)} loading={archive.isPending}>
          {a.archived ? <><ArchiveRestore aria-hidden="true" /> Restore account</> : <><Archive aria-hidden="true" /> Archive account</>}
        </Button>
        <Button variant="ghost" size="sm" className="text-outflow" onClick={() => setDialog("delete")}><Trash2 aria-hidden="true" /> Delete account</Button>
      </div>

      <AccountFormDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} account={a} />
      <AdjustBalanceDialog open={dialog === "adjust"} onOpenChange={(o) => !o && setDialog(null)} account={a} />
      <ReconcileDialog open={dialog === "reconcile"} onOpenChange={(o) => !o && setDialog(null)} account={a} />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${a.name}?`}
        description={a.stats.transactionCount + a.stats.plannedCount > 0 ? "Accounts with transactions can't be deleted — archive it instead to keep your history correct." : "This account has no transactions and will be removed permanently."}
        typeToConfirm={a.name}
        onConfirm={remove}
      />
      <TransactionDetailDialog id={detail} onOpenChange={(o) => !o && setDetail(null)} />
    </>
  );
}
