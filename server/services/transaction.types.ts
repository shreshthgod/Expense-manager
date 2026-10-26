import type { AccountType, TransactionStatus, TransactionType } from "@prisma/client";
import type { ISODate } from "@/lib/dates/date-only";

export interface CategoryRefDTO {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  type: "EXPENSE" | "INCOME" | "BOTH";
}

export interface AccountRefDTO {
  id: string;
  name: string;
  type: AccountType;
  archived: boolean;
}

export interface SplitDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  amount: number;
  note: string | null;
}

export interface TransactionDTO {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  transactionDate: ISODate;
  description: string | null;
  /** Original merchant text exactly as entered or imported. */
  merchant: string | null;
  /** Normalised merchant name (when an alias/name matched). */
  merchantName: string | null;
  merchantId: string | null;
  paymentMethod: string | null;
  notes: string | null;
  location: string | null;
  tags: string[];
  isRecurring: boolean;
  recurringTransactionId: string | null;
  accountId: string | null;
  destinationAccountId: string | null;
  categoryId: string | null;
  account: AccountRefDTO | null;
  destinationAccount: AccountRefDTO | null;
  category: CategoryRefDTO | null;
  isSplit: boolean;
  splits: SplitDTO[];
  /** REFUND: the purchase it refunds. */
  originalTransactionId: string | null;
  /** EXPENSE: total of active refunds against it. */
  refundedAmount: number;
  refundCount: number;
  reconciled: boolean;
  attachmentCount: number;
  importJobId: string | null;
  version: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  /** Signed effect on the account a list was filtered by (account history views). */
  accountEffect?: number;
}

export interface TransactionListTotals {
  count: number;
  income: number;
  expense: number;
  refunds: number;
  transfers: number;
}
