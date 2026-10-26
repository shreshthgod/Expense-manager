"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ErrorState, PageHeader } from "@/components/app/states";
import { Segmented, StatTile } from "@/components/app/kit";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { useInvalidate } from "@/lib/client/query";
import { useAccounts, useApiGet, useCategories } from "@/lib/client/hooks";
import type { ImportJobDTO, PreviewRow } from "@/server/services/import.service";
import { cn } from "@/lib/utils/cn";

type Decision = { action: "import" | "skip"; categoryId: string; transferAccountId: string };

export default function ImportReviewPage() {
  const { id } = useParams<{ id: string }>();
  const f = useFormat();
  const { addToast } = useToast();
  const invalidate = useInvalidate();
  const q = useApiGet<ImportJobDTO>("imports", `/api/import/${id}`);
  const cats = useCategories();
  const accounts = useAccounts();
  const [decisions, setDecisions] = React.useState<Record<number, Decision>>({});
  const [filter, setFilter] = React.useState<"all" | "duplicates" | "problems" | "uncategorised">("all");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!q.data?.rows) return;
    setDecisions(Object.fromEntries(q.data.rows.map((r) => [r.rowIndex, { action: r.defaultAction, categoryId: r.categoryId ?? "", transferAccountId: "" }])));
  }, [q.data?.id, q.data?.rows?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const job = q.data;
  const rows = job.rows ?? [];
  const done = job.status !== "PREVIEWED";
  const d = (r: PreviewRow) => decisions[r.rowIndex] ?? { action: r.defaultAction, categoryId: r.categoryId ?? "", transferAccountId: "" };
  const setD = (r: PreviewRow, patch: Partial<Decision>) => setDecisions((all) => ({ ...all, [r.rowIndex]: { ...d(r), ...patch } }));
  const visible = rows.filter((r) =>
    filter === "duplicates" ? r.duplicate.level !== "unique" : filter === "problems" ? r.errors.length > 0 || r.warnings.length > 0 : filter === "uncategorised" ? !d(r).categoryId && !d(r).transferAccountId && r.errors.length === 0 : true
  );
  const importing = rows.filter((r) => d(r).action === "import" && r.errors.length === 0);
  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api.post<ImportJobDTO>(
        `/api/import/${id}/confirm`,
        { decisions: rows.filter((r) => r.errors.length === 0).map((r) => ({ rowIndex: r.rowIndex, action: d(r).action, categoryId: d(r).categoryId || null, transferAccountId: d(r).transferAccountId || null })) },
        { timeoutMs: 300_000 }
      );
      await invalidate("import");
      addToast(res.message ?? "Imported", "success");
      await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const bulk = (action: "import" | "skip", pred: (r: PreviewRow) => boolean) =>
    setDecisions((all) => ({ ...all, ...Object.fromEntries(rows.filter(pred).map((r) => [r.rowIndex, { ...d(r), action }])) }));

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2"><Link href="/import"><ArrowLeft aria-hidden="true" /> Import</Link></Button>
      <PageHeader title={job.fileName} description={`Statement for ${job.accountName}. ${done ? "This import is finished." : "Choose what to import, then confirm. Nothing has been saved yet."}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Rows" value={job.totalRows} />
        <StatTile label={done ? "Imported" : "Will import"} value={done ? job.importedCount : importing.length} />
        <StatTile label="Possible duplicates" value={job.duplicateCount} />
        <StatTile label={done ? "Skipped / failed" : "Can't import"} value={done ? `${job.skippedCount} / ${job.failedCount}` : rows.filter((r) => r.errors.length).length} />
      </div>
      {done ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-5 text-sm">
            <CheckCircle2 className="h-5 w-5 text-inflow" aria-hidden="true" />
            <span className="flex-1">{job.importedCount} transaction(s) were added{job.completedAt ? ` on ${f.instant(job.completedAt, true)}` : ""}. Undo from the Import page if something went wrong.</span>
            <Button asChild size="sm"><Link href={`/transactions?accountId=${job.accountId}`}>View transactions</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "duplicates", label: "Duplicates" }, { value: "uncategorised", label: "No category" }, { value: "problems", label: "Problems" }]} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => bulk("skip", (r) => r.duplicate.level === "likely")}>Skip likely duplicates</Button>
              <Button size="sm" variant="outline" onClick={() => bulk("import", (r) => r.errors.length === 0)}>Import all valid</Button>
            </div>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <caption className="sr-only">Rows to review</caption>
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">Import</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">Category or transfer</th><th className="px-3 py-2 font-medium">Notes</th></tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((r) => {
                    const dec = d(r);
                    const invalid = r.errors.length > 0;
                    return (
                      <tr key={r.rowIndex} className={cn(dec.action === "skip" && "opacity-60", invalid && "bg-outflow-soft/40")}>
                        <td className="px-3 py-1.5">
                          <input type="checkbox" className="h-4 w-4" disabled={invalid} checked={!invalid && dec.action === "import"} onChange={(e) => setD(r, { action: e.target.checked ? "import" : "skip" })} aria-label={`Import row ${r.rowIndex + 1}`} />
                        </td>
                        <td className="px-3 py-1.5 num">{r.date ? f.dateShort(r.date) : "—"}</td>
                        <td className="max-w-[16rem] px-3 py-1.5"><span className="block truncate" title={r.description ?? ""}>{r.merchant ?? r.description ?? "—"}</span></td>
                        <td className={cn("px-3 py-1.5 text-right num", r.direction === "in" ? "text-inflow" : "text-outflow")}>{r.amount != null ? `${r.direction === "in" ? "+" : "−"}${f.money(r.amount)}` : "—"}</td>
                        <td className="px-3 py-1.5">
                          {!invalid && (
                            <Select
                              aria-label={`Category for row ${r.rowIndex + 1}`}
                              className="h-8 text-xs"
                              value={dec.transferAccountId ? `acct:${dec.transferAccountId}` : dec.categoryId}
                              onChange={(e) => {
                                const v = e.target.value;
                                setD(r, v.startsWith("acct:") ? { transferAccountId: v.slice(5), categoryId: "" } : { categoryId: v, transferAccountId: "" });
                              }}
                            >
                              <option value="">Uncategorised</option>
                              <optgroup label="Categories">
                                {(cats.data ?? []).filter((c) => !c.archived && (r.direction === "in" ? c.type !== "EXPENSE" : c.type !== "INCOME")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </optgroup>
                              <optgroup label="Transfer with">
                                {(accounts.data?.accounts ?? []).filter((a) => a.id !== job.accountId && !a.archived).map((a) => <option key={a.id} value={`acct:${a.id}`}>{a.name}</option>)}
                              </optgroup>
                            </Select>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {r.errors.map((e) => <span key={e} className="block text-outflow">{e}</span>)}
                          {r.duplicate.level !== "unique" && <Badge variant={r.duplicate.level === "likely" ? "outflow" : "warning"}>{r.duplicate.level === "likely" ? "Likely duplicate" : "Possible duplicate"}</Badge>}
                          {r.duplicate.reason && <span className="block text-muted-foreground">{r.duplicate.reason}</span>}
                          {r.categorySource && r.categorySource !== "file" && <span className="block text-muted-foreground">Category from {r.categorySource === "rule" ? "a rule" : "past entries"}</span>}
                          {r.warnings.map((w) => <span key={w} className="block text-warning">{w}</span>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="sticky bottom-20 z-20 mt-4 flex items-center justify-end gap-3 rounded-xl border bg-card p-3 shadow-lg lg:bottom-4">
            <span className="text-sm text-muted-foreground">{importing.length} row(s) will be added to {job.accountName}</span>
            <Button onClick={() => void confirm()} loading={busy} loadingText="Importing…" disabled={importing.length === 0}>Import {importing.length} transaction(s)</Button>
          </div>
        </>
      )}
    </>
  );
}
