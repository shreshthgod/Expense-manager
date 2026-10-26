"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useApiGet } from "@/lib/client/hooks";
import type { ReportSummaryDTO } from "@/server/services/report.service";
import { GenerateReportDialog } from "@/components/reports/generate-report-dialog";

export default function ReportsPage() {
  const q = useApiGet<ReportSummaryDTO[]>("reports", "/api/reports");
  const f = useFormat();
  const { addToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ReportSummaryDTO | null>(null);
  const del = useFinanceMutation({
    affects: ["report"],
    mutationFn: (id: string) => api.delete(`/api/reports/${id}`),
    onSuccess: () => { addToast("Report deleted", "success"); setDeleting(null); },
    onError: (e) => addToast(e.message, "error"),
  });
  return (
    <>
      <PageHeader
        title="Reports"
        description="Saved monthly, quarterly and yearly reports. Each keeps the figures as they were when generated; you'll see a note if records changed since."
        actions={<Button onClick={() => setOpen(true)}><Plus aria-hidden="true" /> Generate report</Button>}
      />
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={FileText} title="No reports yet" description="Generate a report for last month to see income, spending, budgets and goals on one page you can print or export." action={<Button onClick={() => setOpen(true)}>Generate a report</Button>} />
      ) : (
        <Card className="divide-y overflow-hidden">
          {q.data!.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/reports/${r.id}`} className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  {r.stale && <Badge variant="warning"><RefreshCw className="h-3 w-3" aria-hidden="true" /> Records changed since</Badge>}
                  {r.healthScore != null && <Badge variant="secondary">Health {r.healthScore}</Badge>}
                </span>
                <span className="line-clamp-2 text-sm text-muted-foreground">{r.summary}</span>
                <span className="text-xs text-muted-foreground">Generated {f.instant(r.createdAt, true)}</span>
              </Link>
              <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(r)} aria-label={`Delete ${r.title}`}><Trash2 aria-hidden="true" /></Button>
            </div>
          ))}
        </Card>
      )}
      <GenerateReportDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.title ?? "report"}?`} description="Only the saved report is removed." onConfirm={() => deleting && del.mutateAsync(deleting.id)} />
    </>
  );
}
