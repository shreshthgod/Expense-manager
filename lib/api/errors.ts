export interface ErrorDetail {
  path: (string | number)[];
  message: string;
}

/**
 * Domain/API error with a stable machine code. Services throw these; the route
 * wrapper serialises them into `{ success:false, error:{ code, message, details? } }`.
 * (Services never touch HTTP objects — the status is metadata only.)
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthorized(message = "Your session has expired. Please sign in again.") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have access to this resource") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static badRequest(message: string, code = "BAD_REQUEST") {
    return new ApiError(400, code, message);
  }

  /** Field-level validation failure (maps to inline form errors). */
  static validation(details: ErrorDetail[], message?: string) {
    return new ApiError(400, "VALIDATION_ERROR", message ?? details[0]?.message ?? "Some fields need attention", details);
  }

  static field(path: string, message: string) {
    return ApiError.validation([{ path: [path], message }]);
  }

  static conflict(message: string, code = "CONFLICT") {
    return new ApiError(409, code, message);
  }

  /** Optimistic-concurrency failure: the record changed since it was loaded. */
  static versionConflict(entity = "record") {
    return new ApiError(
      409,
      "VERSION_CONFLICT",
      `This ${entity} was changed elsewhere since you opened it. Reload to see the latest version, then re-apply your edit.`
    );
  }

  /** A business rule blocks the operation (e.g. deleting a referenced category). */
  static rule(message: string, code = "RULE_VIOLATION", details?: ErrorDetail[]) {
    return new ApiError(422, code, message, details);
  }

  static tooManyRequests(message = "Too many requests. Please wait a moment and try again.") {
    return new ApiError(429, "RATE_LIMITED", message);
  }

  static unavailable(message = "The service is temporarily unavailable. Please try again shortly.", code = "SERVICE_UNAVAILABLE") {
    return new ApiError(503, code, message);
  }
}
