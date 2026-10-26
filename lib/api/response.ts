import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { AuthConfigurationError } from "@/lib/auth/jwt";
import { logger } from "@/lib/observability/logger";

export function ok<T>(data: T, message?: string, init?: ResponseInit): NextResponse {
  const body = { success: true as const, data, ...(message ? { message } : {}) };
  return NextResponse.json(body, init);
}

export function created<T>(data: T, message = "Created successfully"): NextResponse {
  return ok(data, message, { status: 201 });
}

export function fail(status: number, code: string, message: string, details?: ErrorDetail[]): NextResponse {
  return NextResponse.json(
    { success: false as const, error: { code, message, ...(details?.length ? { details } : {}) } },
    { status, headers: status === 429 ? { "Retry-After": "60" } : undefined }
  );
}

export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.slice(0, 50).map((issue) => ({ path: issue.path, message: issue.message }));
}

/** Maps any thrown error to the standard failure envelope. */
/** Next.js control-flow signals (dynamic rendering bail-out, redirect, notFound) must propagate. */
function isNextSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_"));
}

export function errorResponse(error: unknown, context?: Record<string, unknown>): NextResponse {
  if (isNextSignal(error)) throw error;
  if (error instanceof ApiError) {
    return fail(error.status, error.code, error.message, error.details);
  }
  if (error instanceof ZodError) {
    const details = zodDetails(error);
    return fail(400, "VALIDATION_ERROR", details[0]?.message ?? "Invalid input", details);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return fail(409, "CONFLICT", "A record with these details already exists");
    if (error.code === "P2025") return fail(404, "NOT_FOUND", "Record not found");
    if (error.code === "P2034") return fail(409, "WRITE_CONFLICT", "Another change happened at the same time. Please try again.");
    if (error.code === "P1001" || error.code === "P1002" || error.code === "P1017") {
      logger.error("db.unavailable", { code: error.code, ...context });
      return fail(503, "DATABASE_UNAVAILABLE", "We can't reach the database right now. Your data is safe — please try again shortly.");
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.error("db.unavailable", { message: error.message, ...context });
    return fail(503, "DATABASE_UNAVAILABLE", "We can't reach the database right now. Your data is safe — please try again shortly.");
  }
  if (error instanceof AuthConfigurationError) {
    logger.error("auth.misconfigured", { message: error.message });
    return fail(503, "AUTH_MISCONFIGURED", "Sign-in is temporarily unavailable.");
  }
  logger.error("api.unhandled", { error, ...context });
  return fail(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
}

export async function handleRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw ApiError.badRequest("Request body could not be read", "INVALID_JSON");
  }
  if (text.length > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.badRequest("Request body must be valid JSON", "INVALID_JSON");
  }
}

export function searchParamsObject(request: Request): Record<string, string> {
  const url = new URL(request.url);
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (v !== "") out[k] = v;
  }
  return out;
}
