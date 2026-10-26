"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/app/field";
import { api } from "@/lib/client/api";
import { useFormErrors } from "@/lib/client/form";
import { registerSchema } from "@/lib/validation/schemas";

export default function RegisterPage() {
  const [s, setS] = React.useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = React.useState(false);
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    if (!validate(registerSchema, s)) return;
    setBusy(true);
    try {
      await api.post("/api/auth/register", s, { noAuthRedirect: true });
      window.location.assign("/onboarding");
    } catch (err) {
      handleError(err);
      setBusy(false);
    }
  };
  const strong = s.password.length >= 8 && /[A-Za-z]/.test(s.password) && /\d/.test(s.password);
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Already have one? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Your name" error={errors.name} required>{(p) => <Input {...p} autoComplete="name" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} autoFocus />}</Field>
        <Field label="Email" error={errors.email} required>{(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} />}</Field>
        <Field label="Password" error={errors.password} required hint={strong ? "Looks good." : "At least 8 characters, with a letter and a number."}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} />}
        </Field>
        <Button type="submit" className="w-full" loading={busy} loadingText="Creating account…">Create account</Button>
        <p className="text-xs text-muted-foreground">You'll set your currency, first account and a budget next. It takes about two minutes.</p>
      </form>
    </>
  );
}
