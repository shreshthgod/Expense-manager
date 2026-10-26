import { randomUUID } from "node:crypto";
import { CookieJar, cookieStore } from "./cookies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context: { params: any }) => Promise<Response>;

export interface ApiResult<T = any> {
  status: number;
  body: { success: boolean; data?: T; message?: string; error?: { code: string; message: string; details?: { path: (string | number)[]; message: string }[] } };
  headers: Headers;
}

export interface CallOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  as?: Actor;
}

/** Invokes a Next route handler exactly as the framework would. */
export async function call<T = any>(handler: Handler, method: string, path: string, opts: CallOptions = {}): Promise<ApiResult<T>> {
  const url = new URL(`http://localhost:3000${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = new Headers({ "content-type": "application/json", host: "localhost:3000", ...(opts.headers ?? {}) });
  const request = new Request(url, {
    method,
    headers,
    body: opts.body === undefined || method === "GET" ? undefined : JSON.stringify(opts.body),
  });
  const previous = cookieStore.active();
  if (opts.as) cookieStore.use(opts.as.jar);
  try {
    const response = await handler(request, { params: opts.params ?? {} });
    const text = await response.text();
    let body: ApiResult<T>["body"];
    try {
      body = JSON.parse(text);
    } catch {
      body = { success: response.ok, data: text as unknown as T };
    }
    return { status: response.status, body, headers: response.headers };
  } finally {
    if (opts.as) cookieStore.use(previous);
  }
}

export interface Actor {
  jar: CookieJar;
  userId: string;
  email: string;
  password: string;
}

let counter = 0;

/** Registers a fresh user through the real register route and returns a signed-in actor. */
export async function newActor(name = "Test User"): Promise<Actor> {
  const { POST } = await import("@/app/api/auth/register/route");
  counter += 1;
  const email = `user-${Date.now()}-${counter}-${randomUUID().slice(0, 6)}@test.local`;
  const password = "Str0ngPassw0rd";
  const jar = new CookieJar();
  const res = await call(POST as Handler, "POST", "/api/auth/register", { body: { name, email, password }, as: { jar, userId: "", email, password } });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { jar, userId: res.body.data.id, email, password };
}

export function idem(): Record<string, string> {
  return { "idempotency-key": `test-${randomUUID()}` };
}
