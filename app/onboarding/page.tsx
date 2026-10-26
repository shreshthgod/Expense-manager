"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Field, FormError } from "@/components/app/field";
import { MoneyInput } from "@/components/app/money-input";
import { ErrorState } from "@/components/app/states";
import { useApp } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { qk, useInvalidate } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { ACCOUNT_TYPES, DATE_FORMATS, SUPPORTED_CURRENCIES, isLiabilityType } from "@/lib/constants";
import { onboardingStepSchema } from "@/lib/validation/schemas";
import type { CategoryDTO } from "@/server/services/category.service";
import type { AccountType } from "@/types";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  { id: "preferences", label: "Basics" },
  { id: "income", label: "Income" },
  { id: "account", label: "First account" },
  { id: "categories", label: "Categories" },
  { id: "budget", label: "Budget" },
  { id: "goal", label: "Goal" },
] as const;
type StepId = (typeof STEPS)[number]["id"] | "complete";

interface OnboardingData {
  name: string;
  onboarded: boolean;
  nextStep: StepId;
  state: { completedSteps: string[] };
  values: { currency: string; dateFormat: string; timezone: string; monthStartDay: number; monthlyIncome: number | null; occupation: string | null; account: { name: string } | null };
}

function guessTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

export default function OnboardingPage() {
  const { addToast } = useToast();
  const { applyPreferences } = useApp();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: qk("onboarding"), queryFn: () => api.get<OnboardingData>("/api/onboarding") });
  const cats = useQuery({ queryKey: qk("categories", "onboarding"), queryFn: () => api.get<CategoryDTO[]>("/api/categories", { query: { includeArchived: true } }) });
  const [step, setStep] = React.useState<StepId | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const [v, setV] = React.useState({
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD MMM YYYY",
    monthlyIncome: "",
    occupation: "",
    monthStartDay: "1",
    accountName: "",
    accountType: "BANK" as AccountType,
    opening: "",
    keep: new Set<string>(),
    custom: "",
    budgetName: "Monthly spending",
    budgetAmount: "",
    goalName: "Emergency fund",
    goalTarget: "",
    goalDeadline: "",
  });
  React.useEffect(() => {
    if (!q.data) return;
    setStep((s) => s ?? (q.data.onboarded ? "complete" : q.data.nextStep));
    setV((p) => ({
      ...p,
      currency: q.data.values.currency,
      timezone: q.data.values.timezone === "Asia/Kolkata" ? guessTimeZone() : q.data.values.timezone,
      dateFormat: q.data.values.dateFormat,
      monthlyIncome: q.data.values.monthlyIncome != null ? String(q.data.values.monthlyIncome) : "",
      occupation: q.data.values.occupation ?? "",
      monthStartDay: String(q.data.values.monthStartDay),
    }));
  }, [q.data]);
  React.useEffect(() => {
    if (cats.data && v.keep.size === 0) setV((p) => ({ ...p, keep: new Set(cats.data.filter((c) => !c.archived).map((c) => c.id)) }));
  }, [cats.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (body: Record<string, unknown>, next: StepId) => {
    clear();
    if (!validate(onboardingStepSchema, body)) return;
    setBusy(true);
    try {
      await api.post("/api/onboarding", body);
      if (body.step === "preferences") applyPreferences({ currency: v.currency, timezone: v.timezone, dateFormat: v.dateFormat });
      if (next === "complete" && body.step === "complete") {
        await invalidate("onboarding");
        window.location.assign("/dashboard");
        return;
      }
      setStep(next);
      window.scrollTo({ top: 0 });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const idx = STEPS.findIndex((s) => s.id === step);
  const skipBtn = (s: "account" | "budget" | "goal", next: StepId) => (
    <Button type="button" variant="ghost" onClick={() => void post({ step: s, skip: true }, next)} disabled={busy}>Skip for now</Button>
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm font-medium text-primary">Expense Manager</p>
      <h1 className="mt-1 text-2xl font-semibold">{q.data ? `Welcome, ${q.data.name.split(" ")[0]}` : "Welcome"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">A few questions so your figures are right from day one. You can change all of this later in Settings.</p>
      <ol className="mt-6 flex gap-1.5" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex-1">
            <span className={cn("block h-1.5 rounded-full", i < idx || step === "complete" ? "bg-primary" : i === idx ? "bg-primary/60" : "bg-muted")} aria-hidden="true" />
            <span className={cn("mt-1 hidden text-xs sm:block", i === idx ? "font-medium text-foreground" : "text-muted-foreground")}>{s.label}</span>
            <span className="sr-only">{s.label}{i < idx ? " (done)" : i === idx ? " (current)" : ""}</span>
          </li>
        ))}
      </ol>
      <Card className="mt-6">
        <CardContent className="space-y-5 p-5 sm:p-6">
          {q.isLoading || !step ? (
            <Skeleton className="h-48" />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <FormError message={formError} />
              {step === "preferences" && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void post({ step: "preferences", currency: v.currency, timezone: v.timezone, dateFormat: v.dateFormat }, "income"); }} noValidate>
                  <h2 className="text-lg font-semibold">Currency and time zone</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Currency" error={errors.currency} hint="All amounts use this currency; nothing is converted.">{(p) => <Select {...p} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</Select>}</Field>
                    <Field label="Time zone" error={errors.timezone} hint="Decides what counts as “today”.">{(p) => <Input {...p} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} />}</Field>
                    <Field label="Date format" error={errors.dateFormat}>{(p) => <Select {...p} value={v.dateFormat} onChange={(e) => setV({ ...v, dateFormat: e.target.value })}>{DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>}</Field>
                  </div>
                  <div className="flex justify-end"><Button type="submit" loading={busy}>Continue</Button></div>
                </form>
              )}
              {step === "income" && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void post({ step: "income", monthlyIncome: v.monthlyIncome.replace(/,/g, "") || null, occupation: v.occupation.trim() || null, monthStartDay: v.monthStartDay }, "account"); }} noValidate>
                  <h2 className="text-lg font-semibold">Your income</h2>
                  <p className="text-sm text-muted-foreground">Used only for planning suggestions. Actual income comes from what you record.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Usual monthly take-home" optional error={errors.monthlyIncome}>{(p) => <MoneyInput {...p} value={v.monthlyIncome} onValueChange={(x) => setV({ ...v, monthlyIncome: x })} />}</Field>
                    <Field label="Occupation" optional>{(p) => <Input {...p} value={v.occupation} onChange={(e) => setV({ ...v, occupation: e.target.value })} />}</Field>
                    <Field label="Paid on day" hint="Your months can run payday to payday. Keep 1 for calendar months.">{(p) => <Select {...p} value={v.monthStartDay} onChange={(e) => setV({ ...v, monthStartDay: e.target.value })}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>}</Field>
                  </div>
                  <div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => setStep("preferences")}>Back</Button><Button type="submit" loading={busy}>Continue</Button></div>
                </form>
              )}
              {step === "account" && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(v.opening.replace(/,/g, "") || "0");
                    void post({ step: "account", skip: false, name: v.accountName.trim(), type: v.accountType, openingBalance: isLiabilityType(v.accountType) ? -Math.abs(n) : n }, "categories");
                  }}
                  noValidate
                >
                  <h2 className="text-lg font-semibold">Your main account</h2>
                  <p className="text-sm text-muted-foreground">Start with the account your salary goes into. Add cards, cash and wallets later.</p>
                  {q.data?.values.account && <p className="rounded-lg bg-inflow-soft px-3 py-2 text-sm">Already added: {q.data.values.account.name}</p>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={v.accountName} onChange={(e) => setV({ ...v, accountName: e.target.value })} placeholder="e.g. SBI Salary Account" />}</Field>
                    <Field label="Type" error={errors.type}>{(p) => <Select {...p} value={v.accountType} onChange={(e) => setV({ ...v, accountType: e.target.value as AccountType })}>{ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}</Field>
                    <Field label={isLiabilityType(v.accountType) ? "Amount owed today" : "Balance today"} error={errors.openingBalance}>{(p) => <MoneyInput {...p} value={v.opening} onValueChange={(x) => setV({ ...v, opening: x })} />}</Field>
                  </div>
                  <div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => setStep("income")}>Back</Button><div className="flex gap-2">{skipBtn("account", "categories")}<Button type="submit" loading={busy}>Add account</Button></div></div>
                </form>
              )}
              {step === "categories" && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const custom = v.custom.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name, type: "EXPENSE" }));
                    void post({ step: "categories", keepCategoryIds: [...v.keep], customCategories: custom }, "budget");
                  }}
                  noValidate
                >
                  <h2 className="text-lg font-semibold">Categories</h2>
                  <p className="text-sm text-muted-foreground">Untick ones you won't use (they're archived, not deleted). Add your own below.</p>
                  {cats.isLoading ? <Skeleton className="h-32" /> : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(cats.data ?? []).map((c) => (
                        <label key={c.id} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm">
                          <input type="checkbox" className="h-4 w-4" checked={v.keep.has(c.id)} onChange={(e) => { const k = new Set(v.keep); if (e.target.checked) k.add(c.id); else k.delete(c.id); setV({ ...v, keep: k }); }} />
                          <span className="truncate">{c.name}</span>
                          {c.type === "INCOME" && <span className="text-xs text-muted-foreground">income</span>}
                        </label>
                      ))}
                    </div>
                  )}
                  <Field label="Extra spending categories" optional hint="Comma-separated, e.g. Pets, Kids' school">{(p) => <Input {...p} value={v.custom} onChange={(e) => setV({ ...v, custom: e.target.value })} />}</Field>
                  <div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => setStep("account")}>Back</Button><Button type="submit" loading={busy}>Continue</Button></div>
                </form>
              )}
              {step === "budget" && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void post({ step: "budget", skip: false, name: v.budgetName.trim(), amount: v.budgetAmount.replace(/,/g, ""), categoryId: null }, "goal"); }} noValidate>
                  <h2 className="text-lg font-semibold">A monthly spending limit</h2>
                  <p className="text-sm text-muted-foreground">One overall budget is a good start. You'll see how fast you're spending against it.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" error={errors.name}>{(p) => <Input {...p} value={v.budgetName} onChange={(e) => setV({ ...v, budgetName: e.target.value })} />}</Field>
                    <Field label="Monthly limit" error={errors.amount} required>{(p) => <MoneyInput {...p} value={v.budgetAmount} onValueChange={(x) => setV({ ...v, budgetAmount: x })} />}</Field>
                  </div>
                  <div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => setStep("categories")}>Back</Button><div className="flex gap-2">{skipBtn("budget", "goal")}<Button type="submit" loading={busy}>Create budget</Button></div></div>
                </form>
              )}
              {step === "goal" && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void post({ step: "goal", skip: false, name: v.goalName.trim(), targetAmount: v.goalTarget.replace(/,/g, ""), deadline: v.goalDeadline || null }, "complete"); }} noValidate>
                  <h2 className="text-lg font-semibold">Something to save for</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Goal" error={errors.name}>{(p) => <Input {...p} value={v.goalName} onChange={(e) => setV({ ...v, goalName: e.target.value })} />}</Field>
                    <Field label="Target" error={errors.targetAmount} required>{(p) => <MoneyInput {...p} value={v.goalTarget} onValueChange={(x) => setV({ ...v, goalTarget: x })} />}</Field>
                    <Field label="By" optional error={errors.deadline}>{(p) => <Input {...p} type="date" value={v.goalDeadline} onChange={(e) => setV({ ...v, goalDeadline: e.target.value })} />}</Field>
                  </div>
                  <div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => setStep("budget")}>Back</Button><div className="flex gap-2">{skipBtn("goal", "complete")}<Button type="submit" loading={busy}>Create goal</Button></div></div>
                </form>
              )}
              {step === "complete" && (
                <div className="space-y-4 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-inflow-soft text-inflow"><Check className="h-6 w-6" aria-hidden="true" /></span>
                  <h2 className="text-lg font-semibold">You're set up</h2>
                  <p className="text-sm text-muted-foreground">Record your first expense, or import a bank statement to bring in your history.</p>
                  <Button onClick={() => void post({ step: "complete" }, "complete")} loading={busy}>Go to my dashboard</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {step && step !== "complete" && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Progress is saved after each step.{" "}
          <button type="button" className="underline" onClick={() => { setStep("complete"); addToast("You can finish setup any time in Settings", "info"); }}>Skip the rest</button>
        </p>
      )}
    </main>
  );
}
