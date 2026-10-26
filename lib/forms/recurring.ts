import type { RecurringDTO } from "@/server/services/recurring.service";

export interface RecurringFormState {
  kind: "STANDARD" | "BILL" | "SUBSCRIPTION";
  name: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: string;
  accountId: string;
  destinationAccountId: string;
  categoryId: string;
  merchant: string;
  notes: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: string;
  startDate: string;
  endDate: string;
  autoCreate: boolean;
  autopay: boolean;
  reminderDaysBefore: string;
}

export function emptyRecurringForm(today: string, kind: RecurringFormState["kind"] = "STANDARD"): RecurringFormState {
  return {
    kind,
    name: "",
    type: "EXPENSE",
    amount: "",
    accountId: "",
    destinationAccountId: "",
    categoryId: "",
    merchant: "",
    notes: "",
    frequency: "MONTHLY",
    interval: "1",
    startDate: today,
    endDate: "",
    autoCreate: kind === "SUBSCRIPTION",
    autopay: kind === "SUBSCRIPTION",
    reminderDaysBefore: kind === "BILL" ? "3" : "2",
  };
}

export function recurringFormFromDTO(r: RecurringDTO): RecurringFormState {
  return {
    kind: r.kind,
    name: r.name,
    type: (r.type === "INCOME" || r.type === "TRANSFER" ? r.type : "EXPENSE") as RecurringFormState["type"],
    amount: String(r.amount),
    accountId: r.accountId ?? "",
    destinationAccountId: r.destinationAccountId ?? "",
    categoryId: r.categoryId ?? "",
    merchant: r.merchant ?? "",
    notes: r.notes ?? "",
    frequency: r.frequency,
    interval: String(r.interval),
    startDate: r.startDate,
    endDate: r.endDate ?? "",
    autoCreate: r.autoCreate,
    autopay: r.autopay,
    reminderDaysBefore: String(r.reminderDaysBefore),
  };
}

export function buildRecurringCreateBody(s: RecurringFormState) {
  const transfer = s.type === "TRANSFER";
  return {
    kind: s.kind,
    name: s.name.trim(),
    type: s.kind === "STANDARD" ? s.type : "EXPENSE",
    amount: s.amount.replace(/,/g, "").trim(),
    accountId: s.accountId,
    destinationAccountId: transfer ? s.destinationAccountId || null : null,
    categoryId: transfer ? null : s.categoryId || null,
    merchant: s.merchant.trim() || null,
    notes: s.notes.trim() || null,
    frequency: s.frequency,
    interval: Number(s.interval || "1"),
    startDate: s.startDate,
    endDate: s.endDate || null,
    autoCreate: s.autoCreate,
    autopay: s.autopay,
    reminderDaysBefore: Number(s.reminderDaysBefore || "0"),
  };
}

export function buildRecurringUpdateBody(s: RecurringFormState, version: number) {
  const { kind: _kind, ...rest } = buildRecurringCreateBody(s);
  return { ...rest, version };
}
