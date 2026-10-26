import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import type { TxClient } from "@/server/db/idempotency";

export type AuditAction =
  | "USER_REGISTERED"
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "PASSWORD_CHANGED"
  | "SESSION_REVOKED"
  | "ALL_SESSIONS_REVOKED"
  | "USER_ACCOUNT_DELETED"
  | "PROFILE_UPDATED"
  | "PREFERENCES_UPDATED"
  | "ACCOUNT_CREATED"
  | "ACCOUNT_UPDATED"
  | "ACCOUNT_ARCHIVED"
  | "ACCOUNT_DELETED"
  | "ACCOUNT_ADJUSTED"
  | "TRANSACTION_CREATED"
  | "TRANSACTION_UPDATED"
  | "TRANSACTION_DELETED"
  | "TRANSACTION_RESTORED"
  | "TRANSACTION_POSTED"
  | "TRANSACTIONS_BULK_UPDATED"
  | "IMPORT_COMPLETED"
  | "CATEGORY_CREATED"
  | "CATEGORY_UPDATED"
  | "CATEGORY_DELETED"
  | "BUDGET_CREATED"
  | "BUDGET_UPDATED"
  | "BUDGET_DELETED"
  | "GOAL_CREATED"
  | "GOAL_UPDATED"
  | "GOAL_DELETED"
  | "GOAL_CONTRIBUTION"
  | "RECURRING_CREATED"
  | "RECURRING_UPDATED"
  | "RECURRING_DELETED"
  | "REPORT_GENERATED"
  | "REPORT_DELETED"
  | "DATA_EXPORTED"
  | "BACKUP_EXPORTED"
  | "BACKUP_RESTORED"
  | "RECONCILIATION_COMPLETED"
  | "ONBOARDING_COMPLETED";

export interface AuditParams {
  userId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  /** Keep small and non-sensitive: ids, counts, types — never secrets. */
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function toData(params: AuditParams): Prisma.AuditLogUncheckedCreateInput {
  return {
    userId: params.userId,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId ?? null,
    metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  };
}

/** Best-effort audit outside a transaction (auth events, reads). */
export async function audit(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({ data: toData(params) });
  } catch (error) {
    logger.error("audit.write_failed", { action: params.action, error });
  }
}

/** Audit row committed atomically with the change it describes. */
export async function auditTx(tx: TxClient, params: AuditParams): Promise<void> {
  await tx.auditLog.create({ data: toData(params) });
}

export interface ActivityDTO {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Security-relevant activity for the user's Security settings page. */
export async function listSecurityActivity(userId: string, limit = 30): Promise<ActivityDTO[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      userId,
      action: { in: ["LOGIN", "LOGOUT", "PASSWORD_CHANGED", "SESSION_REVOKED", "ALL_SESSIONS_REVOKED", "USER_REGISTERED", "BACKUP_EXPORTED", "BACKUP_RESTORED", "DATA_EXPORTED"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
  }));
}
