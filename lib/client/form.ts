"use client";

import * as React from "react";
import type { ZodTypeAny } from "zod";
import { ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";

/**
 * Form error state shared by every form:
 *  - field errors (client-side schema parse OR server `details`) render inline
 *  - conflicts / rule violations / outages render as a form-level message
 *  - input is never cleared on failure
 */
export function useFormErrors() {
  const { addToast } = useToast();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const clear = React.useCallback(() => {
    setErrors({});
    setFormError(null);
  }, []);

  const clearField = React.useCallback((name: string) => {
    setErrors((e) => {
      if (!(name in e)) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  }, []);

  /** Validates with the SAME zod schema the server uses. Returns true when valid. */
  const validate = React.useCallback((schema: ZodTypeAny, body: unknown): boolean => {
    const result = schema.safeParse(body);
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_form";
      if (!next[key]) next[key] = issue.message;
    }
    setErrors(next);
    if (next._form) setFormError(next._form);
    return false;
  }, []);

  const handleError = React.useCallback(
    (error: unknown) => {
      if (error instanceof ApiClientError) {
        const fields = error.fieldErrors;
        const keys = Object.keys(fields);
        if (keys.length) {
          setErrors(fields);
          if (fields._form) setFormError(fields._form);
          return;
        }
        if (error.kind === "conflict" || error.kind === "rule" || error.kind === "not_found") {
          setFormError(error.message);
          return;
        }
        if (error.kind === "unauthorized") return; // redirecting to sign-in
      }
      setFormError(null);
      addToast(errorMessage(error), "error");
    },
    [addToast]
  );

  return { errors, formError, setFormError, clear, clearField, validate, handleError };
}

/**
 * One idempotency key per logical submission. It is reused if the same
 * submission is retried after an uncertain failure (timeout/offline) and
 * rotated after a definite outcome or when the form changes.
 */
export function useIdempotencyKey() {
  const ref = React.useRef<string>(newIdempotencyKey());
  return {
    current: () => ref.current,
    rotate: () => {
      ref.current = newIdempotencyKey();
    },
    /** Rotate unless the failure left the outcome unknown. */
    afterError: (error: unknown) => {
      if (!(error instanceof ApiClientError && error.uncertain)) ref.current = newIdempotencyKey();
    },
  };
}

/** Warn before losing unsaved edits on tab close / reload. */
export function useUnsavedChangesWarning(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
