"use client";

import type { ApiFieldError } from "@/types";

/**
 * The ONE way the frontend talks to /api. It understands the response
 * envelope, maps every failure to a typed ApiClientError, exposes field-level
 * validation errors for inline display, and handles session expiry.
 *
 * Money-moving creates pass an idempotency key: if the network drops after the
 * server committed, retrying with the SAME key returns the original result
 * instead of creating a second record.
 */

export type ApiErrorKind =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rule"
  | "rate_limited"
  | "server"
  | "unavailable"
  | "network"
  | "timeout"
  | "invalid_response";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;
  readonly details: ApiFieldError[];
  /** True when the request may have reached the server (network drop/timeout). */
  readonly uncertain: boolean;

  constructor(opts: { status: number; code: string; message: string; kind: ApiErrorKind; details?: ApiFieldError[]; uncertain?: boolean }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.kind = opts.kind;
    this.details = opts.details ?? [];
    this.uncertain = opts.uncertain ?? false;
  }

  /** { fieldName: message } for inline form errors (first message per field). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) {
      const key = d.path.join(".") || "_form";
      if (!out[key]) out[key] = d.message;
    }
    return out;
  }
}

function kindFor(status: number): ApiErrorKind {
  if (status === 400) return "validation";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413 || status === 422) return "rule";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return "server";
}

const FALLBACK_MESSAGES: Record<ApiErrorKind, string> = {
  validation: "Some fields need attention.",
  unauthorized: "Your session has expired. Please sign in again.",
  forbidden: "You don't have access to this.",
  not_found: "This item no longer exists. It may have been deleted.",
  conflict: "This changed elsewhere. Reload to see the latest version.",
  rule: "This action isn't allowed right now.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  server: "Something went wrong on our side. Your data is safe — please try again.",
  unavailable: "The service is temporarily unavailable. Please try again shortly.",
  network: "You appear to be offline. Check your connection and try again.",
  timeout: "The request took too long. Check your connection and try again.",
  invalid_response: "The server sent an unexpected response. Please try again.",
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `em-${crypto.randomUUID()}`;
  return `em-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let redirecting = false;

function redirectToLogin() {
  if (typeof window === "undefined" || redirecting) return;
  const { pathname, search } = window.location;
  if (pathname === "/login" || pathname === "/register") return;
  redirecting = true;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?next=${next}&expired=1`);
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Don't redirect on 401 (login form, background checks). */
  noAuthRedirect?: boolean;
}

export interface ApiSuccess<T> {
  data: T;
  message?: string;
  status: number;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiSuccess<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), opts.timeoutMs ?? 30_000);
  const onAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error; // caller cancelled — let it propagate as AbortError
    const timedOut = controller.signal.reason === "timeout";
    throw new ApiClientError({
      status: 0,
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      kind: timedOut ? "timeout" : "network",
      message: FALLBACK_MESSAGES[timedOut ? "timeout" : "network"],
      uncertain: method !== "GET",
    });
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  let payload: { success?: boolean; data?: T; message?: string; error?: { code: string; message: string; details?: ApiFieldError[] } } | null = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (response.ok && payload?.success) {
    return { data: payload.data as T, message: payload.message, status: response.status };
  }

  const kind = response.ok ? "invalid_response" : kindFor(response.status);
  if (kind === "unauthorized" && !opts.noAuthRedirect) redirectToLogin();
  throw new ApiClientError({
    status: response.status,
    code: payload?.error?.code ?? (response.ok ? "INVALID_RESPONSE" : `HTTP_${response.status}`),
    kind,
    message: payload?.error?.message || FALLBACK_MESSAGES[kind],
    details: payload?.error?.details,
  });
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", path, opts).then((r) => r.data),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, { ...opts, body: body ?? {} }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, opts),
};

/** User-facing text for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "Cancelled.";
  if (error instanceof Error && error.message) return error.message;
  return FALLBACK_MESSAGES.server;
}
