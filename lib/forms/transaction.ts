import type { TransactionDTO } from "@/server/services/transaction.types";

/**
 * Transaction form ⇄ API body. Pages NEVER assemble request bodies inline;
 * tests/unit/contracts.test.ts proves these bodies parse with the endpoint
 * schemas (the v1 UI/API drift that broke every form — KNOWN_ISSUES B1–B8).
 */

export type EntryType = "EXPENSE" | "INCOME" | "TRANSFER";

export interface TransactionFormState {
  type: EntryType;
  amount: string;
  transactionDate: string;
  accountId: string;
  destinationAccountId: string;
  /** Always a database category id (never a name). */
  categoryId: string;
  merchant: string;
  description: string;
  paymentMethod: string;
  notes: string;
  tags: string[];
  /** AUTO = planned when dated in the future, posted otherwise. */
  status: "AUTO" | "POSTED" | "PLANNED";
  /** Empty = single category. Two or more lines = split across categories. */
  splits: SplitFormLine[];
}

export interface SplitFormLine {
  categoryId: string;
  amount: string;
  note: string;
}

export function emptyTransactionForm(defaults: Partial<TransactionFormState> & { today: string }): TransactionFormState {
  const { today, ...rest } = defaults;
  return {
    splits: [],
    type: "EXPENSE",
    amount: "",
    transactionDate: today,
    accountId: "",
    destinationAccountId: "",
    categoryId: "",
    merchant: "",
    description: "",
    paymentMethod: "",
    notes: "",
    tags: [],
    status: "AUTO",
    ...rest,
  };
}

export function transactionFormFromDTO(
  tx: Pick<TransactionDTO, "type" | "amount" | "transactionDate" | "accountId" | "destinationAccountId" | "categoryId" | "merchant" | "description" | "paymentMethod" | "notes" | "tags" | "status"> & {
    splits?: { categoryId: string; amount: number; note: string | null }[] | null;
  }
): TransactionFormState {
  return {
    type: (tx.type === "INCOME" || tx.type === "TRANSFER" ? tx.type : "EXPENSE") as EntryType,
    amount: String(tx.amount),
    transactionDate: tx.transactionDate,
    accountId: tx.accountId ?? "",
    destinationAccountId: tx.destinationAccountId ?? "",
    categoryId: tx.categoryId ?? "",
    merchant: tx.merchant ?? "",
    description: tx.description ?? "",
    paymentMethod: tx.paymentMethod ?? "",
    notes: tx.notes ?? "",
    tags: tx.tags ?? [],
    status: tx.status === "PLANNED" ? "PLANNED" : "AUTO",
    splits: (tx.splits ?? []).map((l) => ({ categoryId: l.categoryId, amount: String(l.amount), note: l.note ?? "" })),
  };
}

/** Switching type clears incompatible fields explicitly (visible to the user). */
export function switchTransactionType(state: TransactionFormState, type: EntryType): TransactionFormState {
  if (state.type === type) return state;
  return {
    ...state,
    type,
    categoryId: "",
    destinationAccountId: type === "TRANSFER" ? state.destinationAccountId : "",
    splits: [],
  };
}

function text(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

function splitBody(s: TransactionFormState) {
  return s.splits.map((l) => ({ categoryId: l.categoryId, amount: l.amount.replace(/,/g, "").trim(), note: text(l.note) }));
}

export function buildTransactionCreateBody(s: TransactionFormState) {
  const isTransfer = s.type === "TRANSFER";
  const split = !isTransfer && s.splits.length > 0;
  return {
    type: s.type,
    amount: s.amount.replace(/,/g, "").trim(),
    transactionDate: s.transactionDate,
    accountId: s.accountId,
    destinationAccountId: isTransfer ? s.destinationAccountId || null : null,
    categoryId: isTransfer || split ? null : s.categoryId || null,
    ...(split ? { splits: splitBody(s) } : {}),
    merchant: text(s.merchant),
    description: text(s.description),
    paymentMethod: text(s.paymentMethod),
    notes: text(s.notes),
    tags: s.tags,
    ...(s.status === "AUTO" ? {} : { status: s.status }),
  };
}

/** Full-record PATCH carrying the version the edit was based on. */
export function buildTransactionUpdateBody(s: TransactionFormState, version: number) {
  const { status: _status, ...body } = buildTransactionCreateBody(s);
  // null explicitly turns a split transaction back into a single-category one.
  return { ...body, splits: s.type !== "TRANSFER" && s.splits.length ? splitBody(s) : null, version };
}
