"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Laptop, LogOut, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/app/field";
import { Segmented } from "@/components/app/kit";
import { ErrorState } from "@/components/app/states";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { qk, useClearAllData, useInvalidate } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { changePasswordSchema, deleteUserSchema } from "@/lib/validation/schemas";
import type { SessionDTO } from "@/server/services/session.service";
import type { ActivityDTO } from "@/server/services/audit.service";
import type { RestorePlan } from "@/server/services/backup.service";

const ACTIVITY_LABEL: Record<string, string> = {
  LOGIN: "Signed in",
  LOGOUT: "Signed out",
  PASSWORD_CHANGED: "Password changed",
  SESSION_REVOKED: "A session was signed out",
  ALL_SESSIONS_REVOKED: "Other sessions signed out",
  USER_REGISTERED: "Account created",
  BACKUP_EXPORTED: "Backup downloaded",
  BACKUP_RESTORED: "Backup restored",
  DATA_EXPORTED: "Data exported",
};

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export function SecuritySection() {
  const f = useFormat();
  const { addToast } = useToast();
  const q = useQuery({ queryKey: qk("sessions"), queryFn: () => api.get<{ sessions: SessionDTO[]; activity: ActivityDTO[] }>("/api/auth/sessions") });
  const [pw, setPw] = React.useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = React.useState(false);
  const { errors, formError, validate, handleError, clear, setFormError } = useFormErrors();
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    if (pw.newPassword !== pw.confirm) {
      setFormError("The new passwords don't match");
      return;
    }
    const body = { currentPassword: pw.currentPassword, newPassword: pw.newPassword };
    if (!validate(changePasswordSchema, body)) return;
    setBusy(true);
    try {
      const res = await api.post("/api/auth/password", body);
      addToast(res.message ?? "Password changed", "success");
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      await q.refetch();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      const res = await api.delete<{ current: boolean }>(`/api/auth/sessions/${id}`);
      if (res.data.current) window.location.assign("/login");
      else await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  const revokeOthers = async () => {
    try {
      const res = await api.post("/api/auth/sessions/revoke-others");
      addToast(res.message ?? "Done", "success");
      await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Change password</CardTitle><CardDescription>Other devices are signed out when your password changes.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={change} className="max-w-md space-y-4" noValidate>
            <FormError message={formError} />
            <Field label="Current password" error={errors.currentPassword} required>{(p) => <Input {...p} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" error={errors.newPassword} required hint="At least 8 characters with a letter and a number.">{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
            <Field label="Repeat new password" required>{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
            <Button type="submit" loading={busy}>Change password</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div><CardTitle>Where you're signed in</CardTitle><CardDescription>Sign out anything you don't recognise.</CardDescription></div>
          <Button size="sm" variant="outline" onClick={() => void revokeOthers()}>Sign out other sessions</Button>
        </CardHeader>
        <CardContent>
          {q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <ul className="divide-y rounded-lg border">
              {q.data!.sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <Laptop className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">{device(s.userAgent)}{s.current && <Badge variant="inflow">This device</Badge>}</span>
                    <span className="text-xs text-muted-foreground">Last active {f.timeAgo(s.lastSeenAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ""}</span>
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => void revoke(s.id)}><LogOut aria-hidden="true" /> Sign out</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent security activity</CardTitle></CardHeader>
        <CardContent>
          {q.data && (q.data.activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
            <ul className="divide-y text-sm">
              {q.data.activity.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{ACTIVITY_LABEL[a.action] ?? a.action}</span>
                  <span className="text-xs text-muted-foreground">{f.instant(a.createdAt, true)}{a.userAgent ? ` · ${device(a.userAgent)}` : ""}</span>
                </li>
              ))}
            </ul>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RestoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useFormat();
  const { addToast } = useToast();
  const invalidate = useInvalidate();
  const [file, setFile] = React.useState<unknown>(null);
  const [fileName, setFileName] = React.useState("");
  const [mode, setMode] = React.useState<"merge" | "replace">("merge");
  const [plan, setPlan] = React.useState<RestorePlan | null>(null);
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setFile(null);
      setFileName("");
      setPlan(null);
      setConfirm("");
      setError(null);
    }
  }, [open]);
  const check = async (data: unknown, m: "merge" | "replace") => {
    setError(null);
    setBusy(true);
    try {
      setPlan((await api.post<RestorePlan>("/api/backup/restore", { mode: m, dryRun: true, file: data }, { timeoutMs: 120_000 })).data);
    } catch (e) {
      setPlan(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = async (f0: File) => {
    if (f0.size > 25 * 1024 * 1024) return setError("Backups can be at most 25 MB.");
    try {
      const parsed = JSON.parse(await f0.text());
      setFile(parsed);
      setFileName(f0.name);
      await check(parsed, mode);
    } catch {
      setError("That file isn't valid JSON.");
    }
  };
  const restore = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ledgerOk: boolean }>("/api/backup/restore", { mode, dryRun: false, confirm: mode === "replace" ? confirm : undefined, file }, { timeoutMs: 240_000 });
      await invalidate("import", "account", "category", "budget", "goal", "recurring", "rule", "preferences");
      addToast(res.data.ledgerOk ? "Backup restored and balances verified" : "Backup restored, but the balance check reported a problem — see Known issues", res.data.ledgerOk ? "success" : "error");
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Restore from backup</DialogTitle><DialogDescription>The file is checked first. Nothing changes until you confirm, and the restore is all-or-nothing.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FormError message={error} />
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:bg-accent/40">
            <Upload className="h-5 w-5" aria-hidden="true" />
            {fileName || "Choose an Expense Manager backup (.json)"}
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          </label>
          <Segmented label="Restore mode" value={mode} onChange={(m) => { setMode(m); if (file) void check(file, m); }} options={[{ value: "merge", label: "Add to my data" }, { value: "replace", label: "Replace my data" }]} />
          {busy && !plan && <Skeleton className="h-24" />}
          {plan && (
            <div className="space-y-3 rounded-lg border p-3 text-sm">
              <p>Backup from {plan.exportedAt ? f.instant(plan.exportedAt, true) : "an unknown date"} (app {plan.appVersion ?? "?"}, format {plan.schemaVersion}).</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-3">
                {Object.entries(plan.counts).filter(([, n]) => n > 0).map(([k, n]) => <li key={k}>{n} {k}</li>)}
              </ul>
              {plan.problems.length > 0 && <ul className="list-disc pl-5 text-outflow">{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
              {plan.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
              {plan.willDelete && <p className="text-xs">Will delete: {Object.entries(plan.willDelete).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}.</p>}
              {mode === "replace" && <Field label='Type REPLACE to confirm'>{(p) => <Input {...p} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}</Field>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void restore()} loading={busy && !!plan} disabled={!plan || plan.problems.length > 0 || (mode === "replace" && confirm !== "REPLACE")} variant={mode === "replace" ? "destructive" : "default"}>
            {mode === "replace" ? "Replace and restore" : "Restore"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EXPORTS = [
  { type: "transactions", label: "Transactions" },
  { type: "accounts", label: "Accounts" },
  { type: "budgets", label: "Budgets" },
  { type: "goals", label: "Goals" },
  { type: "recurring", label: "Recurring & bills" },
  { type: "subscriptions", label: "Subscriptions" },
];

export function DataSection() {
  const { addToast } = useToast();
  const clearAll = useClearAllData();
  const [restore, setRestore] = React.useState(false);
  const [del, setDel] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { password, confirmation };
    if (!validate(deleteUserSchema, body)) return;
    setBusy(true);
    try {
      await api.delete("/api/user", { body });
      clearAll();
      addToast("Your account was deleted", "info");
      window.location.assign("/");
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Backup</CardTitle><CardDescription>A complete copy of your accounts, transactions, budgets, goals, bills, rules and settings in one file.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild><a href="/api/backup" download><Download aria-hidden="true" /> Download backup</a></Button>
          <Button variant="outline" onClick={() => setRestore(true)}><Upload aria-hidden="true" /> Restore from backup</Button>
          <p className="w-full text-xs text-muted-foreground">Receipts, notifications and chat history aren't included. Keep backups somewhere private — they contain your financial history.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Export to spreadsheet</CardTitle><CardDescription>CSV files that open in Excel or Google Sheets.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {EXPORTS.map((x) => <Button key={x.type} asChild variant="outline" size="sm"><a href={`/api/export?type=${x.type}`} download><Download aria-hidden="true" /> {x.label}</a></Button>)}
        </CardContent>
      </Card>
      <Card className="border-outflow/30">
        <CardHeader><CardTitle>Delete account</CardTitle><CardDescription>Permanently deletes your account and every record. This can't be undone — download a backup first.</CardDescription></CardHeader>
        <CardContent>
          {!del ? (
            <Button variant="destructive" onClick={() => setDel(true)}>Delete my account…</Button>
          ) : (
            <form onSubmit={deleteAccount} className="max-w-md space-y-4" noValidate>
              <FormError message={formError} />
              <Field label="Your password" error={errors.password} required>{(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
              <Field label='Type DELETE to confirm' error={errors.confirmation} required>{(p) => <Input {...p} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />}</Field>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setDel(false)}>Cancel</Button>
                <Button type="submit" variant="destructive" loading={busy}>Permanently delete</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      <RestoreDialog open={restore} onOpenChange={setRestore} />
    </div>
  );
}
