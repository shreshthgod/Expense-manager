"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Field, FormError } from "@/components/app/field";
import { Segmented } from "@/components/app/kit";
import { AccountSelect } from "@/components/app/pickers";
import { ErrorState } from "@/components/app/states";
import { useApp } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { qk, useFinanceMutation } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { usePreferencesQuery } from "@/lib/client/hooks";
import { DATE_FORMATS, SUPPORTED_CURRENCIES } from "@/lib/constants";
import { preferenceUpdateSchema, profileUpdateSchema } from "@/lib/validation/schemas";
import type { PreferencesDTO } from "@/server/services/preference.service";
import { useTheme } from "next-themes";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];

/** Saves a preference patch and applies it everywhere immediately. */
function usePreferenceSaver() {
  const { applyPreferences } = useApp();
  const { addToast } = useToast();
  return useFinanceMutation({
    affects: ["preferences"],
    mutationFn: async (patch: Partial<PreferencesDTO>) => (await api.patch<PreferencesDTO>("/api/preferences", patch)).data,
    onSuccess: (p) => {
      applyPreferences({
        currency: p.currency,
        dateFormat: p.dateFormat,
        theme: p.theme as "light" | "dark" | "system",
        motion: p.motion as "system" | "reduced" | "off",
        timezone: p.timezone,
        weekStartsOn: p.weekStartsOn,
        monthStartDay: p.monthStartDay,
        defaultAccountId: p.defaultAccountId,
      });
      addToast("Saved", "success");
    },
    onError: (e) => addToast(e.message, "error"),
  });
}

export function ProfileSection() {
  const { addToast } = useToast();
  const { user } = useApp();
  const q = useQuery({ queryKey: qk("profile"), queryFn: () => api.get<{ name: string; email: string; avatarUrl: string | null; createdAt: string }>("/api/profile") });
  const [name, setName] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  React.useEffect(() => {
    if (q.data) {
      setName(q.data.name);
      setAvatarUrl(q.data.avatarUrl ?? "");
    }
  }, [q.data]);
  const save = useFinanceMutation({ affects: ["profile"], mutationFn: (body: unknown) => api.patch("/api/profile", body) });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { name: name.trim(), avatarUrl: avatarUrl.trim() || null };
    if (!validate(profileUpdateSchema, body)) return;
    try {
      await save.mutateAsync(body);
      addToast("Profile updated. Refresh to see your new name everywhere.", "success");
    } catch (err) {
      handleError(err);
    }
  };
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <CardHeader><CardTitle>Profile</CardTitle><CardDescription>Signed in as {user.email}</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-lg space-y-4" noValidate>
          <FormError message={formError} />
          <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
          <Field label="Avatar image URL" optional error={errors.avatarUrl} hint="An https:// link to an image. Leave empty to show your initials.">
            {(p) => <Input {...p} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} inputMode="url" />}
          </Field>
          <Button type="submit" loading={save.isPending}>Save profile</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function FinancialSection() {
  const q = usePreferencesQuery();
  const save = usePreferenceSaver();
  const [draft, setDraft] = React.useState<Partial<PreferencesDTO>>({});
  const { errors, validate } = useFormErrors();
  React.useEffect(() => setDraft({}), [q.data]);
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = { ...q.data, ...draft };
  const set = <K extends keyof PreferencesDTO>(k: K, v: PreferencesDTO[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length > 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate(preferenceUpdateSchema, draft)) return;
    save.mutate(draft);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Money & periods</CardTitle>
        <CardDescription>These change how every figure is shown and how months and weeks are counted.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-2" noValidate>
          <Field label="Currency" error={errors.currency} hint={q.data.currencyLocked ? "Locked once you have accounts — amounts are never converted." : "Choose before adding accounts; amounts are never converted."}>
            {(c) => (
              <Select {...c} value={p.currency} disabled={q.data.currencyLocked} onChange={(e) => set("currency", e.target.value)}>
                {SUPPORTED_CURRENCIES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Date format" error={errors.dateFormat}>
            {(c) => <Select {...c} value={p.dateFormat} onChange={(e) => set("dateFormat", e.target.value)}>{DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>}
          </Field>
          <Field label="Time zone" error={errors.timezone} hint="Decides what “today” is for dates and due items.">
            {(c) => (
              <Select {...c} value={p.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {[...new Set([p.timezone, ...TIME_ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Week starts on" error={errors.weekStartsOn}>
            {(c) => <Select {...c} value={String(p.weekStartsOn)} onChange={(e) => set("weekStartsOn", Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>}
          </Field>
          <Field label="Financial month starts on day" error={errors.monthStartDay} hint="Set to your payday (e.g. 25) to see months as pay cycles.">
            {(c) => <Select {...c} value={String(p.monthStartDay)} onChange={(e) => set("monthStartDay", Number(e.target.value))}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>}
          </Field>
          <Field label="Default account for new entries" error={errors.defaultAccountId}>
            {(c) => <AccountSelect control={c} allowNone placeholder="Remember my last choice" value={p.defaultAccountId ?? ""} onChange={(v) => set("defaultAccountId", v || null)} />}
          </Field>
          <Field label="Emergency fund target (months)" error={errors.emergencyFundMonths}>
            {(c) => <Select {...c} value={String(p.emergencyFundMonths)} onChange={(e) => set("emergencyFundMonths", Number(e.target.value))}>{[3, 4, 6, 9, 12].map((n) => <option key={n} value={n}>{n} months</option>)}</Select>}
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" disabled={!dirty} loading={save.isPending}>Save changes</Button>
            {dirty && <Button type="button" variant="ghost" onClick={() => setDraft({})}>Discard</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function AppearanceSection() {
  const q = usePreferencesQuery();
  const save = usePreferenceSaver();
  const { setTheme } = useTheme();
  const { preferences } = useApp();
  return (
    <Card>
      <CardHeader><CardTitle>Appearance</CardTitle><CardDescription>Theme and motion apply on this and every other device you sign in to.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Theme</p>
          <Segmented
            label="Theme"
            value={preferences.theme}
            onChange={(v) => { setTheme(v); save.mutate({ theme: v }); }}
            options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Match device" }]}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Motion</p>
          <Segmented
            label="Motion"
            value={preferences.motion}
            onChange={(v) => save.mutate({ motion: v })}
            options={[{ value: "system", label: "Match device" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }]}
          />
          <p className="text-xs text-muted-foreground">Reduced keeps simple fades; Off removes animation entirely. “Match device” follows your system's reduce-motion setting.</p>
        </div>
        {q.isError && <ErrorState error={q.error} />}
      </CardContent>
    </Card>
  );
}

const NOTIFY: { key: keyof PreferencesDTO; label: string; help: string }[] = [
  { key: "notifyBudget", label: "Budget alerts", help: "When a budget reaches 50%, 75%, 90% and 100% in its current period." },
  { key: "notifyBills", label: "Bill and subscription reminders", help: "Before bills and renewals are due, and when they're overdue." },
  { key: "notifyRecurring", label: "Recurring entries", help: "When a recurring transaction is recorded or couldn't be recorded." },
  { key: "notifyGoal", label: "Goal milestones", help: "25/50/75/100% and approaching deadlines." },
  { key: "notifyAnomalies", label: "Unusual expenses", help: "An expense far above your usual amount for that category." },
  { key: "notifyAIInsight", label: "Insights and reports", help: "When a report is ready or there's a notable insight." },
];

export function NotificationsSection() {
  const q = usePreferencesQuery();
  const save = usePreferenceSaver();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <CardHeader><CardTitle>Notifications</CardTitle><CardDescription>Choose what you're told about. Each alert is sent once per event.</CardDescription></CardHeader>
      <CardContent className="divide-y">
        {NOTIFY.map((n) => (
          <label key={n.key} className="flex items-center justify-between gap-4 py-3">
            <span><span className="block text-sm font-medium">{n.label}</span><span className="text-xs text-muted-foreground">{n.help}</span></span>
            <Switch checked={Boolean(q.data![n.key])} onCheckedChange={(c) => save.mutate({ [n.key]: c } as Partial<PreferencesDTO>)} aria-label={n.label} />
          </label>
        ))}
      </CardContent>
    </Card>
  );
}
