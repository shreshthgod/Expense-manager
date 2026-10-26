import { isLiabilityType } from "@/lib/constants";
import type { AccountType } from "@/types";
import type { AccountDTO } from "@/server/services/account.service";

export interface AccountFormState {
  name: string;
  type: AccountType;
  /** What the user types: for liabilities this is the amount OWED (positive). */
  openingAmount: string;
  openingDate: string;
  institution: string;
  notes: string;
  includeInNetWorth: boolean;
  /** Credit cards only. */
  creditLimit: string;
  statementDay: string;
  paymentDueDay: string;
  maskedNumber: string;
}

export function emptyAccountForm(today: string, type: AccountType = "BANK"): AccountFormState {
  return { name: "", type, openingAmount: "", openingDate: today, institution: "", notes: "", includeInNetWorth: true, creditLimit: "", statementDay: "", paymentDueDay: "", maskedNumber: "" };
}

export function accountFormFromDTO(a: AccountDTO): AccountFormState {
  const liability = isLiabilityType(a.type);
  return {
    name: a.name,
    type: a.type,
    openingAmount: String(liability ? -a.openingBalance : a.openingBalance),
    openingDate: a.openingDate ?? "",
    institution: a.institution ?? "",
    notes: a.notes ?? "",
    includeInNetWorth: a.includeInNetWorth,
    creditLimit: a.card?.creditLimit != null ? String(a.card.creditLimit) : "",
    statementDay: a.card?.statementDay != null ? String(a.card.statementDay) : "",
    paymentDueDay: a.card?.paymentDueDay != null ? String(a.card.paymentDueDay) : "",
    maskedNumber: a.card?.maskedNumber ?? "",
  };
}

function cardFields(s: AccountFormState) {
  if (s.type !== "CREDIT_CARD") return {};
  return {
    creditLimit: s.creditLimit.replace(/,/g, "").trim() || null,
    statementDay: s.statementDay || null,
    paymentDueDay: s.paymentDueDay || null,
    maskedNumber: s.maskedNumber.trim() || null,
  };
}

/** Converts "amount owed" into the signed ledger convention (liabilities negative). */
export function signedOpening(type: AccountType, amount: string): number {
  const n = Number(amount.replace(/,/g, "").trim() || "0");
  if (!Number.isFinite(n)) return Number.NaN;
  return isLiabilityType(type) ? -Math.abs(n) : n;
}

export function buildAccountCreateBody(s: AccountFormState) {
  return {
    name: s.name.trim(),
    type: s.type,
    openingBalance: signedOpening(s.type, s.openingAmount),
    openingDate: s.openingDate || undefined,
    institution: s.institution.trim() || null,
    notes: s.notes.trim() || null,
    includeInNetWorth: s.includeInNetWorth,
    ...cardFields(s),
  };
}

export function buildAccountUpdateBody(s: AccountFormState, version: number, opts: { canEditOpening: boolean }) {
  return {
    version,
    name: s.name.trim(),
    type: s.type,
    institution: s.institution.trim() || null,
    notes: s.notes.trim() || null,
    includeInNetWorth: s.includeInNetWorth,
    ...cardFields(s),
    ...(opts.canEditOpening ? { openingBalance: signedOpening(s.type, s.openingAmount), openingDate: s.openingDate || undefined } : {}),
  };
}
