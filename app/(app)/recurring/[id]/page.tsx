"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Pencil, RotateCcw, SkipForward, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, PageHeader } from "@/components/app/states";
import { StatTile } from "@/components/app/kit";
import { Field } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { AccountSelect } from "@/components/app/pickers";
import { RecurringFormDialog, STATE_LABEL, useOccurrenceActions } from "@/components/recurring/recurring-manager";
import { useFormat } from "@/components/providers/app-context";
import { useApiGet } from "@/lib/client/hooks";
import { describeRecurrence } from "@/lib/finance/recurrence";
import type { OccurrenceDTO, RecurringDTO } from "@/server/services/recurring.service";

type Detail = RecurringDTO & { history: OccurrenceDTO[]; preview: string[] };

const OCC_LABEL: Record<string, { label: string; variant: "secondary" | "warning" | "inflow" | "outflow" | "outline" }> = {
  SCHEDULED: { label: "Scheduled", variant: "secondary" },
  DUE: { label: "Due", variant: "warning" },
  RECORDED: { label: "Recorded", variant: "inflow" },
  SKIPPED: { label: "Skipped", variant: "outline" },
  FAILED: { label: "Couldn't record", variant: "outflow" },
  EXPECTED: { label: "Expected", variant: "secondary" },
};

function SettleDialog({ r, occ, onOpenChange }: { r: Detail; occ: OccurrenceDTO | null; onOpenChange: (o: boolean) => void }) {
  const f = useFormat();
  const { settle } = useOccurrenceActions();
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  React.useEffect(() => {
    if (occ) {
      setAmount(String(occ.amount));
      setDate(occ.dueDate > f.today() ? f.today() : occ.dueDate);
      setAccountId(r.accountId ?? "");
    }
  }, [occ, r.accountId, f]);
  return (
    <Dialog open={!!occ} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Record {r.name}</DialogTitle>
          <DialogDescription>Creates the real transaction for the {occ ? f.date(occ.dueDate) : ""} occurrence. Change anything that differed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount">{(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}</Field>
          <Field label="Paid on">{(p) => <Input {...p} type="date" value={date} max={f.today()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Account" className="sm:col-span-2">{(p) => <AccountSelect control={p} value={accountId} onChange={setAccountId} />}</Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            loading={settle.isPending}
            onClick={() =>
              occ &&
              settle.mutate(
                { id: r.id, date: occ.dueDate, body: { mode: "create", amount: amount.replace(/,/g, ""), transactionDate: date, accountId } },
                { onSuccess: () => onOpenChange(false) }
              )
            }
          >
            Record transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecurringDetailPage() {
  const { id } = useParams<{ id: string }>();
  const f = useFormat();
  const q = useApiGet<Detail>("recurring", `/api/recurring/${id}`);
  const { update } = useOccurrenceActions();
  const [editing, setEditing] = React.useState(false);
  const [settling, setSettling] = React.useState<OccurrenceDTO | null>(null);
  const [override, setOverride] = React.useState<{ date: string; amount: string } | null>(null);

  if (q.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const back = r.kind === "BILL" ? "/bills" : r.kind === "SUBSCRIPTION" ? "/subscriptions" : "/recurring";
  const state = STATE_LABEL[r.state];
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href={back}><ArrowLeft aria-hidden="true" /> Back</Link>
      </Button>
      <PageHeader
        title={r.name}
        description={`${describeRecurrence(r.frequency, r.interval)} · ${r.type === "TRANSFER" ? `${r.accountName} → ${r.destinationAccountName}` : `${r.categoryName ?? "No category"} · ${r.accountName ?? ""}`}`}
        actions={<Button variant="outline" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /> Edit</Button>}
      >
        <div className="mt-1 flex gap-2">
          <Badge variant={state.variant}>{state.label}</Badge>
          {r.autoCreate && <Badge variant="outline">Recorded automatically</Badge>}
        </div>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Amount" value={f.money(r.amount)} />
        <StatTile label="Per month" value={f.money(r.monthlyEquivalent)} />
        <StatTile label="Per year" value={f.money(r.annualEquivalent)} />
        <StatTile label="Next" value={r.nextDueDate ? f.dateShort(r.nextDueDate) : "—"} hint={r.endDate ? `Ends ${f.date(r.endDate)}` : "No end date"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Each date is recorded once. Skipped dates never create a transaction.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dates have come due yet.</p>
            ) : (
              <ul className="divide-y">
                {r.history.map((o) => {
                  const l = OCC_LABEL[o.status] ?? OCC_LABEL.SCHEDULED;
                  const open = o.status === "DUE" || o.status === "FAILED" || o.status === "SCHEDULED";
                  return (
                    <li key={o.dueDate} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="w-28 num">{f.date(o.dueDate)}</span>
                      <Badge variant={l.variant}>{l.label}</Badge>
                      <span className="ml-auto font-medium num">{f.money(o.amount)}</span>
                      <span className="flex w-full justify-end gap-1 sm:w-auto">
                        {open && (
                          <>
                            <Button size="xs" onClick={() => setSettling(o)}><CheckCircle2 aria-hidden="true" /> Record</Button>
                            <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: r.id, date: o.dueDate, body: { action: "skip" } })}><SkipForward aria-hidden="true" /> Skip</Button>
                            <Button size="xs" variant="ghost" onClick={() => setOverride({ date: o.dueDate, amount: String(o.amount) })}>Change amount</Button>
                          </>
                        )}
                        {o.status === "FAILED" && <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: r.id, date: o.dueDate, body: { action: "retry" } })}><RotateCcw aria-hidden="true" /> Retry</Button>}
                        {o.status === "SKIPPED" && <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: r.id, date: o.dueDate, body: { action: "unskip" } })}><Undo2 aria-hidden="true" /> Un-skip</Button>}
                        {o.transactionId && <Button asChild size="xs" variant="link"><Link href={`/transactions?focus=${o.transactionId}`}>View</Link></Button>}
                      </span>
                      {o.failureReason && <span className="w-full text-xs text-outflow">{o.failureReason}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Coming up</CardTitle></CardHeader>
          <CardContent>
            {r.preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">No future dates{r.cancelled ? " — cancelled" : r.active ? "" : " while paused"}.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {r.preview.map((d) => (
                  <li key={d} className="flex justify-between"><span>{f.date(d)}</span><span className="text-muted-foreground">{f.relative(d)}</span></li>
                ))}
              </ul>
            )}
            {r.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</p>}
          </CardContent>
        </Card>
      </div>
      <RecurringFormDialog open={editing} onOpenChange={setEditing} kind={r.kind} existing={r} />
      <SettleDialog r={r} occ={settling} onOpenChange={(o) => !o && setSettling(null)} />
      <Dialog open={!!override} onOpenChange={(o) => !o && setOverride(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Change this date's amount</DialogTitle>
            <DialogDescription>Only {override ? f.date(override.date) : ""} changes; the usual amount stays the same.</DialogDescription>
          </DialogHeader>
          <Field label="Amount">{(p) => <MoneyInput {...p} value={override?.amount ?? ""} onValueChange={(v) => setOverride((o) => (o ? { ...o, amount: v } : o))} />}</Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(null)}>Cancel</Button>
            <Button
              loading={update.isPending}
              onClick={() => override && update.mutate({ id: r.id, date: override.date, body: { action: "override", amount: override.amount.replace(/,/g, "") } }, { onSuccess: () => setOverride(null) })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
