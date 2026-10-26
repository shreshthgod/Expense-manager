"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/app/field";
import { api, ApiClientError } from "@/lib/client/api";
import { useFormErrors } from "@/lib/client/form";
import { safeNext } from "@/lib/client/safe-next";
import { loginSchema } from "@/lib/validation/schemas";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { errors, formError, validate, handleError, clear, setFormError } = useFormErrors();
  const expired = params.get("expired") === "1";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { email, password };
    if (!validate(loginSchema, body)) return;
    setBusy(true);
    try {
      const res = await api.post<{ onboardedAt: string | null }>("/api/auth/login", body, { noAuthRedirect: true });
      // Full navigation so the server layout reads the new session cookie.
      window.location.assign(res.data.onboardedAt ? safeNext(params.get("next")) : "/onboarding");
    } catch (err) {
      setPassword("");
      // 401 here means wrong email or password, not an expired session.
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 429)) setFormError(err.message);
      else handleError(err);
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        New here? <Link href="/register" className="font-medium text-primary hover:underline">Create an account</Link>
      </p>
      {expired && <p role="status" className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-sm">Your session ended. Sign in again to continue where you left off.</p>}
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Email" error={errors.email} required>
          {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        </Field>
        <Field label="Password" error={errors.password} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" className="w-full" loading={busy} loadingText="Signing in…">Sign in</Button>
      </form>
      <p className="mt-6 text-xs text-muted-foreground">Forgot your password? Password reset by email isn't available yet — see the project README for how an administrator can reset it.</p>
    </>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}
