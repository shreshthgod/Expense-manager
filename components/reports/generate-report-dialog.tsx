"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/app/field";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { reportGenerateSchema } from "@/lib/validation/schemas";
import type { ReportSummaryDTO } from "@/server/services/report.service";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function GenerateReportDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (o: boolean) => void; preset?: { type: string; year: number; month?: number; quarter?: number } }) {
  const f = useFormat();
  const { addToast } = useToast();
  const [y, m] = f.today().split("-").map(Number) as [number, number];
  const [type, setType] = React.useState("MONTHLY");
  const [year, setYear] = React.useState(String(y));
  const [month, setMonth] = React.useState(String(m === 1 ? 12 : m - 1));
  const [quarter, setQuarter] = React.useState(String(Math.max(1, Math.ceil(m / 3) - 1) || 1));
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  React.useEffect(() => {
    if (open && preset) {
      setType(preset.type);
      setYear(String(preset.year));
      if (preset.month) setMonth(String(preset.month));
      if (preset.quarter) setQuarter(String(preset.quarter));
    }
  }, [open, preset]);
  const gen = useFinanceMutation({
    affects: ["report"],
    mutationFn: (body: unknown) => api.post<ReportSummaryDTO>("/api/reports", body),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { type, year: Number(year), month: type === "MONTHLY" ? Number(month) : undefined, quarter: type === "QUARTERLY" ? Number(quarter) : undefined };
    if (!validate(reportGenerateSchema, body)) return;
    try {
      const res = await gen.mutateAsync(body);
      addToast("Report ready", "success");
      onOpenChange(false);
      window.location.assign(`/reports/${res.data.id}`);
    } catch (err) {
      handleError(err);
    }
  };
  const years = Array.from({ length: 6 }, (_, i) => y - i);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Generate a report</DialogTitle>
          <DialogDescription>Figures are computed from your records first; the written summary only describes them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" error={errors.type}>{(p) => <Select {...p} value={type} onChange={(e) => setType(e.target.value)}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option></Select>}</Field>
            <Field label="Year" error={errors.year}>{(p) => <Select {...p} value={year} onChange={(e) => setYear(e.target.value)}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</Select>}</Field>
            {type === "MONTHLY" && <Field label="Month" error={errors.month}>{(p) => <Select {...p} value={month} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</Select>}</Field>}
            {type === "QUARTERLY" && <Field label="Quarter" error={errors.quarter}>{(p) => <Select {...p} value={quarter} onChange={(e) => setQuarter(e.target.value)}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</Select>}</Field>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={gen.isPending} loadingText="Generating…">Generate</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

