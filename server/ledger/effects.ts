import { Prisma } from "@prisma/client";
import { fromMinor, toMinor } from "@/lib/utils/money";
import type { TxClient } from "@/server/db/idempotency";

/**
 * THE ledger. Every balance change in the application is derived from
 * `ledgerEffects()`; services never hand-roll `balance += x`.
 *
 * Invariant (verified by tests/integration/ledger-invariants.test.ts):
 *   account.balance = account.openingBalance + Σ ledgerEffects(t)[account]
 *   over all transactions t of the account.
 *
 * Only POSTED, non-deleted rows have effects. PLANNED rows are projections.
 */

export interface LedgerRow {
  type: string;
  status: string;
  amount: Prisma.Decimal | number | string;
  accountId: string | null;
  destinationAccountId: string | null;
  deletedAt?: Date | null;
}

/** accountId → signed delta in minor units (paise). */
export type Effects = Map<string, number>;

function add(effects: Effects, accountId: string | null, minor: number) {
  if (!accountId || minor === 0) return;
  effects.set(accountId, (effects.get(accountId) ?? 0) + minor);
}

export function ledgerEffects(row: LedgerRow | null | undefined): Effects {
  const effects: Effects = new Map();
  if (!row || row.deletedAt || row.status !== "POSTED") return effects;
  const amount = toMinor(row.amount.toString());
  switch (row.type) {
    case "EXPENSE":
      add(effects, row.accountId, -amount);
      break;
    case "INCOME":
    case "REFUND":
      add(effects, row.accountId, amount);
      break;
    case "TRANSFER":
      // v1 transfers without a destination never moved money; keep them inert.
      if (row.accountId && row.destinationAccountId) {
        add(effects, row.accountId, -amount);
        add(effects, row.destinationAccountId, amount);
      }
      break;
    case "ADJUSTMENT":
      add(effects, row.accountId, -amount);
      add(effects, row.destinationAccountId, amount);
      break;
  }
  return effects;
}

/** Effects needed to move the ledger from `before` to `after` (after − before). */
export function effectsDiff(before: LedgerRow | null | undefined, after: LedgerRow | null | undefined): Effects {
  const diff: Effects = new Map();
  for (const [id, v] of ledgerEffects(after)) add(diff, id, v);
  for (const [id, v] of ledgerEffects(before)) add(diff, id, -v);
  for (const [id, v] of diff) if (v === 0) diff.delete(id);
  return diff;
}

export function mergeEffects(...all: Effects[]): Effects {
  const out: Effects = new Map();
  for (const e of all) for (const [id, v] of e) add(out, id, v);
  for (const [id, v] of out) if (v === 0) out.delete(id);
  return out;
}

export function effectsToObject(effects: Effects): Record<string, number> {
  return Object.fromEntries([...effects].map(([id, minor]) => [id, fromMinor(minor)]));
}

/**
 * Applies balance deltas inside the caller's database transaction. Account ids
 * are applied in sorted order so concurrent transactions lock rows in the same
 * order (no deadlocks). Every update is scoped by userId.
 */
export async function applyEffects(tx: TxClient, userId: string, effects: Effects): Promise<void> {
  const ids = [...effects.keys()].sort();
  for (const accountId of ids) {
    const minor = effects.get(accountId) ?? 0;
    if (minor === 0) continue;
    const delta = new Prisma.Decimal(fromMinor(minor).toFixed(2));
    const result = await tx.account.updateMany({
      where: { id: accountId, userId },
      data: { balance: { increment: delta } },
    });
    if (result.count !== 1) {
      throw new Error(`Ledger integrity: account ${accountId} not found for user while applying effects`);
    }
  }
}
