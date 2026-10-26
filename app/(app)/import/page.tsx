"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileUp, Info, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/states";
import { Field, FormError } from "@/components/app/field";
import { AccountSelect } from "@/components/app/pickers";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { qk, useFinanceMutation } from "@/lib/client/query";
import { parseCsv, sha256Hex } from "@/lib/import/csv";
import { IMPORT_PRESETS, detectMapping, resolvePreset, suggestPreset } from "@/lib/import/presets";
import { normalizeRow } from "@/lib/import/normalize";
import { IMPORT_DATE_FORMATS, importMappingConfig, type ImportMappingConfig } from "@/lib/validation/schemas";
import type { ImportJobDTO } from "@/server/services/import.service";

const MAX_BYTES = 5 * 1024 * 1024;
const COLUMNS: { key: keyof ImportMappingConfig; label: string; modes?: ImportMappingConfig["amountMode"][] }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description / narration" },
  { key: "merchant", label: "Merchant (optional)" },
  { key: "amount", label: "Amount", modes: ["SIGNED", "TYPE_COLUMN"] },
  { key: "debit", label: "Money out (debit)", modes: ["DEBIT_CREDIT"] },
  { key: "credit", label: "Money in (credit)", modes: ["DEBIT_CREDIT"] },
  { key: "type", label: "Dr/Cr column", modes: ["TYPE_COLUMN"] },
  { key: "category", label: "Category (optional)" },
  { key: "reference", label: "Reference (optional)" },
];

function History() {
  const f = useFormat();
  const { addToast } = useToast();
  const q = useQuery({ queryKey: qk("imports", "list"), queryFn: () => api.get<ImportJobDTO[]>("/api/import") });
  const [undoing, setUndoing] = React.useState<ImportJobDTO | null>(null);
  const undo = useFinanceMutation({
    affects: ["import"],
    mutationFn: (id: string) => api.post(`/api/import/${id}/undo`),
    onSuccess: (res) => { addToast(res.message ?? "Import undone", "success"); setUndoing(null); },
    onError: (e) => addToast(e.message, "error"),
  });
  if (!q.data?.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Previous imports</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {q.data.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 py-2">
              <Link href={`/import/${j.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{j.fileName}</Link>
              <span className="text-xs text-muted-foreground">{j.accountName} · {f.timeAgo(j.createdAt)}</span>
              <Badge variant={j.status === "COMPLETED" ? "inflow" : j.status === "PREVIEWED" ? "warning" : j.status === "FAILED" ? "outflow" : "secondary"}>
                {j.status === "PREVIEWED" ? "Waiting for review" : j.status === "COMPLETED" ? `${j.importedCount} imported` : j.status.toLowerCase()}
              </Badge>
              {j.status !== "PREVIEWED" && j.importedCount > 0 && <Button size="xs" variant="ghost" onClick={() => setUndoing(j)}><Undo2 aria-hidden="true" /> Undo</Button>}
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={!!undoing}
        onOpenChange={(o) => !o && setUndoing(null)}
        title={`Undo import of ${undoing?.fileName ?? ""}?`}
        description={`Removes the ${undoing?.importedCount ?? 0} transaction(s) it created. Balances, budgets and reports update. Transactions you edited afterwards are removed too.`}
        confirmLabel="Undo import"
        onConfirm={() => undoing && undo.mutateAsync(undoing.id)}
      />
    </Card>
  );
}

export default function ImportPage() {
  const router = useRouter();
  const f = useFormat();
  const { addToast } = useToast();
  const [accountId, setAccountId] = React.useState("");
  const [file, setFile] = React.useState<{ name: string; hash: string; headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = React.useState<ImportMappingConfig | null>(null);
  const [presetId, setPresetId] = React.useState("");
  const [saveAs, setSaveAs] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const saved = useQuery({ queryKey: qk("imports", "mappings"), queryFn: () => api.get<{ id: string; name: string; config: ImportMappingConfig }[]>("/api/import/mappings") });

  const onFile = async (f0: File) => {
    setError(null);
    if (f0.size > MAX_BYTES) return setError("Files can be at most 5 MB. Split larger statements by date.");
    if (!/\.(csv|txt)$/i.test(f0.name)) return setError("Export your statement as CSV (most banks offer it under “Download”).");
    const text = await f0.text();
    const parsed = parseCsv(text);
    if (!parsed.headers.length || !parsed.rows.length) return setError("Couldn't find a header row and data in this file.");
    if (parsed.rows.length > 5000) return setError("Import at most 5,000 rows at a time.");
    setFile({ name: f0.name, hash: await sha256Hex(text), headers: parsed.headers, rows: parsed.rows });
    const suggested = suggestPreset(parsed.headers);
    setPresetId(suggested?.id ?? "");
    setMapping(suggested ? resolvePreset(suggested, parsed.headers) : detectMapping(parsed.headers));
  };

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (!file) return;
    const builtIn = IMPORT_PRESETS.find((p) => p.id === id);
    if (builtIn) setMapping(resolvePreset(builtIn, file.headers));
    const own = saved.data?.find((s) => `saved:${s.id}` === id);
    if (own) setMapping(own.config);
  };

  const preview = React.useMemo(() => (file && mapping ? file.rows.slice(0, 6).map((r, i) => normalizeRow(r, file.headers, mapping, i)) : []), [file, mapping]);
  const set = (k: keyof ImportMappingConfig, v: unknown) => setMapping((m) => (m ? { ...m, [k]: v === "" ? null : v } as ImportMappingConfig : m));

  const submit = async () => {
    if (!file || !mapping) return;
    setError(null);
    if (!accountId) return setError("Choose the account this statement belongs to.");
    const check = importMappingConfig.safeParse(mapping);
    if (!check.success) return setError(check.error.issues[0]?.message ?? "Finish the column mapping");
    setBusy(true);
    try {
      if (saveAs.trim()) await api.post("/api/import/mappings", { name: saveAs.trim(), config: mapping }).catch(() => undefined);
      const res = await api.post<ImportJobDTO>("/api/import", { accountId, fileName: file.name, fileHash: file.hash, mapping, headers: file.headers, rows: file.rows }, { timeoutMs: 120_000 });
      router.push(`/import/${res.data.id}`);
    } catch (e) {
      setError(errorMessage(e));
      addToast("Couldn't read the statement", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Import a statement" description="Upload a CSV bank or card statement. You'll review every row, and duplicates are flagged, before anything is saved." />
      <div className="space-y-5">
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          This reads a file you download from your bank. It isn't a live bank connection, and the file isn't stored after import.
        </p>
        <Card>
          <CardHeader><CardTitle>1. Account and file</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Statement for account" required>{(p) => <AccountSelect control={p} value={accountId} onChange={setAccountId} />}</Field>
            <Field label="CSV file" required hint="Up to 5 MB / 5,000 rows">
              {(p) => (
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent/40">
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span className="truncate">{file ? `${file.name} · ${file.rows.length} rows` : "Choose a file"}</span>
                  <input {...p} type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
                </label>
              )}
            </Field>
          </CardContent>
        </Card>
        {error && <FormError message={error} />}
        {file && mapping && (
          <Card>
            <CardHeader>
              <CardTitle>2. Match the columns</CardTitle>
              <CardDescription>We guessed from the headers. Check the preview below looks right.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Format">
                  {(p) => (
                    <Select {...p} value={presetId} onChange={(e) => applyPreset(e.target.value)}>
                      <option value="">Custom</option>
                      <optgroup label="Common formats">{IMPORT_PRESETS.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</optgroup>
                      {(saved.data ?? []).length > 0 && <optgroup label="Saved">{saved.data!.map((s) => <option key={s.id} value={`saved:${s.id}`}>{s.name}</option>)}</optgroup>}
                    </Select>
                  )}
                </Field>
                <Field label="Date format">{(p) => <Select {...p} value={mapping.dateFormat} onChange={(e) => set("dateFormat", e.target.value)}>{IMPORT_DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>}</Field>
                <Field label="Amounts are">
                  {(p) => (
                    <Select {...p} value={mapping.amountMode} onChange={(e) => set("amountMode", e.target.value)}>
                      <option value="DEBIT_CREDIT">Two columns (debit / credit)</option>
                      <option value="SIGNED">One column, negative = out</option>
                      <option value="TYPE_COLUMN">One column + Dr/Cr column</option>
                    </Select>
                  )}
                </Field>
                {COLUMNS.filter((c) => !c.modes || c.modes.includes(mapping.amountMode)).map((c) => (
                  <Field key={c.key} label={c.label}>
                    {(p) => (
                      <Select {...p} value={(mapping[c.key] as string | null) ?? ""} onChange={(e) => set(c.key, e.target.value)}>
                        <option value="">— not in file —</option>
                        {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    )}
                  </Field>
                ))}
                {mapping.amountMode === "SIGNED" && (
                  <label className="flex items-center gap-2 text-sm sm:col-span-3">
                    <Checkbox checked={mapping.positiveIsExpense} onCheckedChange={(c) => set("positiveIsExpense", !!c)} /> Positive amounts are money out (some card statements)
                  </label>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[36rem] text-sm">
                  <caption className="sr-only">Preview of the first rows</caption>
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">Problems</th></tr></thead>
                  <tbody className="divide-y">
                    {preview.map((r) => (
                      <tr key={r.rowIndex}>
                        <td className="px-3 py-1.5 num">{r.date ? f.dateShort(r.date) : "—"}</td>
                        <td className="max-w-[18rem] truncate px-3 py-1.5">{r.merchant ?? r.description ?? "—"}</td>
                        <td className={`px-3 py-1.5 text-right num ${r.direction === "in" ? "text-inflow" : r.direction === "out" ? "text-outflow" : ""}`}>{r.amount != null ? `${r.direction === "in" ? "+" : "−"}${f.money(r.amount)}` : "—"}</td>
                        <td className="px-3 py-1.5 text-xs text-outflow">{r.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Save this mapping as" optional className="w-64">{(p) => <Input {...p} value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder="e.g. My SBI export" />}</Field>
                <Button onClick={() => void submit()} loading={busy} loadingText="Checking rows…" disabled={!accountId}>
                  <FileUp aria-hidden="true" /> Review {file.rows.length} rows
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <History />
      </div>
    </>
  );
}
