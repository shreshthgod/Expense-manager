import { z } from "zod";
import { ACCOUNT_TYPE_VALUES, DATE_FORMATS, PAGE_SIZE_OPTIONS, SUPPORTED_CURRENCIES } from "@/lib/constants";
import { isValidTimeZone } from "@/lib/dates/date-only";
import {
  idField,
  isoDate,
  moneyAmount,
  nonNegativeMoney,
  nullableIdField,
  nullableIsoDate,
  nullableText,
  pageParam,
  pageSizeParam,
  queryBoolean,
  recordVersion,
  requiredText,
  signedMoney,
  tagList,
} from "./primitives";

/**
 * Single source of truth for request validation. Route handlers must import
 * from here — no inline schemas in app/api/** (v1 drift: KNOWN_ISSUES S2).
 * Frontend payload builders in lib/forms/** are contract-tested against these.
 */

export * from "./primitives";

export interface FieldIssue {
  path: (string | number)[];
  message: string;
}

// ---------------------------------------------------------------------------
// Auth & user
// ---------------------------------------------------------------------------

export const passwordSchema = z
  .string({ required_error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const registerSchema = z.object({
  name: requiredText(80, "Name", 2),
  email: z.string({ required_error: "Email is required" }).trim().toLowerCase().email("Enter a valid email").max(254),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string({ required_error: "Email is required" }).trim().toLowerCase().email("Enter a valid email").max(254),
  password: z.string({ required_error: "Password is required" }).min(1, "Password is required").max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(128),
  newPassword: passwordSchema,
  signOutOtherSessions: z.boolean().default(true),
});

export const deleteUserSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm").max(128),
  confirmation: z.literal("DELETE", { errorMap: () => ({ message: 'Type "DELETE" to confirm' }) }),
});

export const profileUpdateSchema = z.object({
  name: requiredText(80, "Name", 2).optional(),
  avatarUrl: z.preprocess(
    (v) => (v === "" ? null : v),
    z
      .string()
      .trim()
      .max(500)
      .url("Enter a valid URL")
      .refine((u) => u.startsWith("https://"), "Avatar URL must use https://")
      .nullable()
  ).optional(),
});

const currencyCodes = SUPPORTED_CURRENCIES.map((c) => c.code) as [string, ...string[]];

export const preferenceUpdateSchema = z.object({
  currency: z.enum(currencyCodes).optional(),
  dateFormat: z.enum(DATE_FORMATS).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  motion: z.enum(["system", "reduced", "off"]).optional(),
  timezone: z.string().trim().max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
  notifyBudget: z.boolean().optional(),
  notifyGoal: z.boolean().optional(),
  notifyAIInsight: z.boolean().optional(),
  notifyRecurring: z.boolean().optional(),
  notifyBills: z.boolean().optional(),
  notifyAnomalies: z.boolean().optional(),
  weekStartsOn: z.coerce.number().int().min(0).max(6).optional(),
  monthStartDay: z.coerce.number().int().min(1, "Choose a day between 1 and 28").max(28, "Choose a day between 1 and 28").optional(),
  defaultAccountId: nullableIdField("Choose an account").optional(),
  emergencyFundMonths: z.coerce.number().int().min(1).max(24).optional(),
  dashboardLayout: z
    .object({
      order: z.array(z.string().max(40)).max(30),
      hidden: z.array(z.string().max(40)).max(30),
      period: z.enum(["this_month", "last_month", "this_week", "this_year"]).default("this_month"),
    })
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// Onboarding (step-wise, resumable, idempotent)
// ---------------------------------------------------------------------------

export const onboardingStepSchema = z
  .discriminatedUnion("step", [
    z.object({
      step: z.literal("preferences"),
      currency: z.enum(currencyCodes),
      timezone: z.string().trim().max(64).refine(isValidTimeZone, "Unknown time zone"),
      dateFormat: z.enum(DATE_FORMATS).optional(),
    }),
    z.object({
      step: z.literal("income"),
      monthlyIncome: z.preprocess((v) => (v === "" ? null : v), nonNegativeMoney.nullable()),
      occupation: nullableText(120, "Occupation").optional(),
      monthStartDay: z.coerce.number().int().min(1).max(28).optional(),
    }),
    z.object({
      step: z.literal("account"),
      skip: z.boolean().default(false),
      name: requiredText(80, "Account name").optional(),
      type: z.enum(ACCOUNT_TYPE_VALUES).optional(),
      openingBalance: signedMoney.optional(),
      openingDate: isoDate.optional(),
      institution: nullableText(80, "Institution").optional(),
    }),
    z.object({
      step: z.literal("categories"),
      /** Default categories the user keeps active (others are archived, never deleted). */
      keepCategoryIds: z.array(idField()).max(200),
      customCategories: z
        .array(z.object({ name: requiredText(60, "Category name"), type: z.enum(["EXPENSE", "INCOME"]) }))
        .max(24)
        .default([]),
    }),
    z.object({
      step: z.literal("budget"),
      skip: z.boolean().default(false),
      name: requiredText(80, "Budget name").optional(),
      amount: moneyAmount.optional(),
      categoryId: nullableIdField("Choose a category").optional(),
    }),
    z.object({
      step: z.literal("goal"),
      skip: z.boolean().default(false),
      name: requiredText(80, "Goal name").optional(),
      targetAmount: moneyAmount.optional(),
      deadline: nullableIsoDate.optional(),
    }),
    z.object({ step: z.literal("complete") }),
  ])
  .superRefine((v, ctx) => {
    const need = (ok: unknown, path: string, message: string) => {
      if (ok == null || ok === "") ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (v.step === "account" && !v.skip) {
      need(v.name, "name", "Account name is required");
      need(v.type, "type", "Choose an account type");
    }
    if (v.step === "budget" && !v.skip) {
      need(v.name, "name", "Budget name is required");
      need(v.amount, "amount", "Enter a budget amount");
    }
    if (v.step === "goal" && !v.skip) {
      need(v.name, "name", "Goal name is required");
      need(v.targetAmount, "targetAmount", "Enter a target amount");
    }
  });
export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** Credit-card details. Only the last 4 digits are ever accepted — never full numbers or CVV. */
function creditCardFields() {
  return {
    creditLimit: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
    statementDay: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(1).max(31).nullable()).optional(),
    paymentDueDay: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(1).max(31).nullable()).optional(),
    maskedNumber: z
      .preprocess((v) => (v === "" ? null : v), z.string().trim().regex(/^\d{4}$/, "Enter only the last 4 digits").nullable())
      .optional(),
  };
}

export const accountCreateSchema = z.object({
  name: requiredText(80, "Account name"),
  type: z.enum(ACCOUNT_TYPE_VALUES, { errorMap: () => ({ message: "Choose an account type" }) }),
  /** Signed: liabilities are negative while money is owed. */
  openingBalance: signedMoney.default(0),
  openingDate: isoDate.optional(),
  institution: nullableText(80, "Institution").optional(),
  notes: nullableText(500, "Notes").optional(),
  includeInNetWorth: z.boolean().default(true),
  currency: z.string().length(3).optional(),
  ...creditCardFields(),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  version: recordVersion,
  name: requiredText(80, "Account name").optional(),
  type: z.enum(ACCOUNT_TYPE_VALUES).optional(),
  institution: nullableText(80, "Institution").optional(),
  notes: nullableText(500, "Notes").optional(),
  includeInNetWorth: z.boolean().optional(),
  /** Only allowed while the account has no transactions; otherwise use an adjustment. */
  openingBalance: signedMoney.optional(),
  openingDate: isoDate.optional(),
  archived: z.boolean().optional(),
  ...creditCardFields(),
});
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export const accountAdjustmentSchema = z.object({
  /** The real-world balance the account should show as of `date`. */
  targetBalance: signedMoney,
  date: isoDate,
  reason: requiredText(240, "Reason"),
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, "Colour must be a hex value like #22c55e");

export const categoryCreateSchema = z.object({
  name: requiredText(60, "Category name"),
  icon: nullableText(40, "Icon").optional(),
  color: hexColor.nullable().optional(),
  type: z.enum(["EXPENSE", "INCOME", "BOTH"]).default("EXPENSE"),
  spendingClass: z.enum(["ESSENTIAL", "DISCRETIONARY"]).nullable().optional(),
  costBehavior: z.enum(["FIXED", "VARIABLE"]).nullable().optional(),
});

export const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const categoryDeleteSchema = z.object({
  /** Required when the category is referenced: records are moved here first. */
  reassignToCategoryId: nullableIdField("Choose a category").optional(),
});

export const categoryQuerySchema = z.object({
  includeArchived: queryBoolean.optional(),
  type: z.enum(["EXPENSE", "INCOME", "BOTH"]).optional(),
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const TRANSACTION_ENTRY_TYPES = ["EXPENSE", "INCOME", "TRANSFER"] as const;
export type TransactionEntryType = (typeof TRANSACTION_ENTRY_TYPES)[number];

export interface TransactionShape {
  type?: string | null;
  accountId?: string | null;
  destinationAccountId?: string | null;
  categoryId?: string | null;
  splits?: { amount: number }[] | null;
}

/**
 * Structural rules shared by create, merged update and client forms:
 *  - TRANSFER: source + different destination, no category
 *  - EXPENSE / INCOME: category required, no destination
 */
export function transactionShapeIssues(v: TransactionShape): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!v.accountId) issues.push({ path: ["accountId"], message: "Select an account" });
  if (v.type === "TRANSFER") {
    if (!v.destinationAccountId) {
      issues.push({ path: ["destinationAccountId"], message: "Select the account receiving the money" });
    } else if (v.destinationAccountId === v.accountId) {
      issues.push({ path: ["destinationAccountId"], message: "Choose a different account than the source" });
    }
    if (v.categoryId) issues.push({ path: ["categoryId"], message: "Transfers do not have a category" });
    if (v.splits && v.splits.length) issues.push({ path: ["splits"], message: "Transfers can't be split" });
  } else {
    if (!v.categoryId && !(v.splits && v.splits.length)) issues.push({ path: ["categoryId"], message: "Select a category" });
    if (v.destinationAccountId) {
      issues.push({ path: ["destinationAccountId"], message: "Only transfers have a destination account" });
    }
  }
  return issues;
}

export const splitLine = z.object({
  categoryId: idField("Select a category"),
  amount: moneyAmount,
  note: nullableText(120, "Note").optional(),
});
export type SplitLineInput = z.infer<typeof splitLine>;

/** Σ split amounts must equal the transaction amount exactly (in paise). */
export function splitIssues(amount: number | undefined, splits: { amount: number }[] | null | undefined): FieldIssue[] {
  if (!splits || splits.length === 0 || amount == null) return [];
  const total = splits.reduce((a, l) => a + Math.round(l.amount * 100), 0);
  const target = Math.round(amount * 100);
  if (total === target) return [];
  const diff = (target - total) / 100;
  return [
    {
      path: ["splits"],
      message: diff > 0 ? `Split lines are ${diff.toFixed(2)} short of the total` : `Split lines exceed the total by ${(-diff).toFixed(2)}`,
    },
  ];
}

const transactionFields = {
  type: z.enum(TRANSACTION_ENTRY_TYPES, { errorMap: () => ({ message: "Choose expense, income or transfer" }) }),
  amount: moneyAmount,
  transactionDate: isoDate,
  accountId: idField("Select an account"),
  destinationAccountId: nullableIdField("Select an account").optional(),
  categoryId: nullableIdField("Select a category").optional(),
  description: nullableText(240, "Description").optional(),
  merchant: nullableText(120, "Merchant").optional(),
  paymentMethod: nullableText(40, "Payment method").optional(),
  notes: nullableText(1200, "Notes").optional(),
  location: nullableText(160, "Location").optional(),
  tags: tagList.optional(),
  /** Omitted → PLANNED for future dates, POSTED otherwise. */
  status: z.enum(["PLANNED", "POSTED"]).optional(),
  /** Category allocations; when present they replace categoryId and must sum to amount. */
  splits: z.array(splitLine).min(2, "A split needs at least two lines").max(20).nullable().optional(),
};

export const transactionCreateSchema = z.object(transactionFields).superRefine((v, ctx) => {
  for (const issue of [...transactionShapeIssues(v), ...splitIssues(v.amount, v.splits)]) ctx.addIssue({ code: "custom", ...issue });
});
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;

/** Income endpoint: same model, type fixed to INCOME. */
export const incomeCreateSchema = z
  .object({ ...transactionFields, type: z.literal("INCOME").default("INCOME") })
  .superRefine((v, ctx) => {
    for (const issue of [...transactionShapeIssues(v), ...splitIssues(v.amount, v.splits)]) ctx.addIssue({ code: "custom", ...issue });
  });

/** PATCH: fields optional; the merged record is re-validated in the service. */
export const transactionUpdateSchema = z.object({
  version: recordVersion,
  type: transactionFields.type.optional(),
  amount: moneyAmount.optional(),
  transactionDate: isoDate.optional(),
  accountId: idField("Select an account").optional(),
  destinationAccountId: transactionFields.destinationAccountId,
  categoryId: transactionFields.categoryId,
  description: transactionFields.description,
  merchant: transactionFields.merchant,
  paymentMethod: transactionFields.paymentMethod,
  notes: transactionFields.notes,
  location: transactionFields.location,
  tags: transactionFields.tags,
  splits: transactionFields.splits,
  /** Required to change or delete a transaction inside a reconciled statement period. */
  confirmReconciledChange: z.boolean().optional(),
});
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

export const transactionPostSchema = z.object({
  version: recordVersion,
  /** Optionally move the date to the actual posting date. */
  transactionDate: isoDate.optional(),
});

export const transactionDeleteSchema = z.object({
  version: recordVersion.optional(),
  /** Explicit dependency resolution: also delete this purchase's refunds. */
  withRefunds: queryBoolean.optional(),
  confirmReconciledChange: queryBoolean.optional(),
});

export const refundCreateSchema = z.object({
  amount: moneyAmount,
  transactionDate: isoDate,
  /** Account receiving the money (a card refund reduces the card's balance owed). */
  accountId: idField("Select the account that received the refund"),
  /** Which allocation is refunded (defaults to the purchase's category). */
  categoryId: nullableIdField("Select a category").optional(),
  description: nullableText(240, "Description").optional(),
  notes: nullableText(1200, "Notes").optional(),
});
export type RefundCreateInput = z.infer<typeof refundCreateSchema>;

export const BULK_ACTIONS = ["categorize", "addTag", "removeTag", "moveAccount", "delete"] as const;
export const bulkActionSchema = z
  .object({
    action: z.enum(BULK_ACTIONS),
    ids: z.array(idField()).min(1, "Select at least one transaction").max(500, "At most 500 transactions at a time"),
    categoryId: idField("Choose a category").optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    accountId: idField("Choose an account").optional(),
    /** Preview only: report what would change without writing. */
    dryRun: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.action === "categorize" && !v.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    if ((v.action === "addTag" || v.action === "removeTag") && !v.tag) ctx.addIssue({ code: "custom", path: ["tag"], message: "Enter a tag" });
    if (v.action === "moveAccount" && !v.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "Choose an account" });
  });

export const TRANSACTION_SORT_FIELDS = ["transactionDate", "amount", "createdAt", "merchant"] as const;

export const transactionQuerySchema = z
  .object({
    page: pageParam,
    pageSize: pageSizeParam(PAGE_SIZE_OPTIONS),
    search: nullableText(120, "Search").optional(),
    type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "ADJUSTMENT", "REFUND"]).optional(),
    status: z.enum(["PLANNED", "POSTED"]).optional(),
    categoryId: idField("Invalid category").optional(),
    uncategorized: queryBoolean.optional(),
    accountId: idField("Invalid account").optional(),
    merchant: nullableText(120, "Merchant").optional(),
    paymentMethod: nullableText(40, "Payment method").optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    minAmount: z.coerce.number().nonnegative("Minimum must be 0 or more").optional(),
    maxAmount: z.coerce.number().positive("Maximum must be greater than 0").optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    sortBy: z.enum(TRANSACTION_SORT_FIELDS).default("transactionDate"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((v, ctx) => {
    if (v.minAmount != null && v.maxAmount != null && v.minAmount > v.maxAmount) {
      ctx.addIssue({ code: "custom", path: ["maxAmount"], message: "Maximum must be at least the minimum" });
    }
    if (v.startDate && v.endDate && v.startDate > v.endDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date" });
    }
  });
export type TransactionQueryInput = z.infer<typeof transactionQuerySchema>;

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const BUDGET_PERIODS = ["WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"] as const;

const budgetFields = {
  name: requiredText(80, "Budget name"),
  amount: moneyAmount,
  period: z.enum(BUDGET_PERIODS, { errorMap: () => ({ message: "Choose a budget period" }) }),
  startDate: isoDate,
  endDate: nullableIsoDate.optional(),
  categoryId: nullableIdField("Choose a category").optional(),
  rolloverMode: z.enum(["NONE", "POSITIVE_ONLY", "FULL"]).default("NONE"),
};

export function budgetShapeIssues(v: { period?: string; startDate?: string | null; endDate?: string | null }): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (v.period === "CUSTOM" && !v.endDate) {
    issues.push({ path: ["endDate"], message: "Custom budgets need an end date" });
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    issues.push({ path: ["endDate"], message: "End date must be on or after the start date" });
  }
  return issues;
}

export const budgetCreateSchema = z.object(budgetFields).superRefine((v, ctx) => {
  for (const issue of budgetShapeIssues(v)) ctx.addIssue({ code: "custom", ...issue });
});
export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;

export const budgetUpdateSchema = z.object({
  version: recordVersion,
  name: budgetFields.name.optional(),
  amount: moneyAmount.optional(),
  period: budgetFields.period.optional(),
  startDate: isoDate.optional(),
  endDate: budgetFields.endDate,
  categoryId: budgetFields.categoryId,
  rolloverMode: z.enum(["NONE", "POSITIVE_ONLY", "FULL"]).optional(),
});
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>;

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const goalCreateSchema = z.object({
  name: requiredText(80, "Goal name"),
  targetAmount: moneyAmount,
  /** Amount already saved when the goal is created. */
  currentAmount: nonNegativeMoney.default(0),
  deadline: nullableIsoDate.optional(),
  category: nullableText(60, "Category").optional(),
  description: nullableText(500, "Description").optional(),
  kind: z.enum(["SAVINGS", "SINKING_FUND", "EMERGENCY_FUND"]).default("SAVINGS"),
  accountId: nullableIdField("Choose an account").optional(),
  monthlyContribution: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
  repeatsYearly: z.boolean().default(false),
});
export type GoalCreateInput = z.infer<typeof goalCreateSchema>;

export const goalUpdateSchema = z.object({
  version: recordVersion,
  name: requiredText(80, "Goal name").optional(),
  targetAmount: moneyAmount.optional(),
  deadline: nullableIsoDate.optional(),
  category: nullableText(60, "Category").optional(),
  description: nullableText(500, "Description").optional(),
  kind: z.enum(["SAVINGS", "SINKING_FUND", "EMERGENCY_FUND"]).optional(),
  accountId: nullableIdField("Choose an account").optional(),
  monthlyContribution: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
  repeatsYearly: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

export const goalContributionSchema = z
  .object({
    /** Positive adds to the goal, negative releases money from it. */
    amount: signedMoney.refine((v) => v !== 0, "Amount cannot be zero"),
    date: isoDate.optional(),
    note: nullableText(240, "Note").optional(),
    /**
     * "earmark" (default): money already held is set aside — no money moves.
     * "transfer": money physically moves between accounts via a linked TRANSFER.
     */
    mode: z.enum(["earmark", "transfer"]).default("earmark"),
    fromAccountId: nullableIdField("Choose an account").optional(),
    toAccountId: nullableIdField("Choose an account").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "transfer") {
      if (!v.fromAccountId) ctx.addIssue({ code: "custom", path: ["fromAccountId"], message: "Choose where the money comes from" });
      if (!v.toAccountId) ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose where the money goes" });
      if (v.fromAccountId && v.fromAccountId === v.toAccountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose a different account" });
      }
    }
  });

export const budgetTemplateSchema = z.object({
  name: requiredText(60, "Template name"),
  items: z
    .array(
      z.object({
        name: requiredText(80, "Budget name"),
        categoryId: nullableIdField("Choose a category").optional(),
        amount: moneyAmount,
        period: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).default("MONTHLY"),
        rolloverMode: z.enum(["NONE", "POSITIVE_ONLY", "FULL"]).default("NONE"),
      })
    )
    .min(1, "Add at least one budget")
    .max(50),
});

export const budgetTemplateApplySchema = z.object({
  startDate: isoDate,
  /** Existing budgets for the same scope are only changed with explicit consent. */
  replaceConflicts: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationQuerySchema = z.object({
  page: pageParam,
  pageSize: pageSizeParam([5, 10, 20, 50], 20),
  unreadOnly: queryBoolean.optional(),
});

export const notificationUpdateSchema = z.object({ read: z.boolean() });

// ---------------------------------------------------------------------------
// Analytics & reports
// ---------------------------------------------------------------------------

export const RANGE_PRESETS = ["this_week", "this_month", "last_month", "3_months", "6_months", "this_year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const analyticsRangeSchema = z
  .object({
    preset: z.enum(RANGE_PRESETS).default("this_month"),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.preset === "custom" && (!v.startDate || !v.endDate)) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "Choose a start and end date" });
    }
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date" });
    }
  });

export const trendQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export const reportGenerateSchema = z
  .object({
    type: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12).optional(),
    quarter: z.coerce.number().int().min(1).max(4).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "MONTHLY" && v.month == null) ctx.addIssue({ code: "custom", path: ["month"], message: "Choose a month" });
    if (v.type === "QUARTERLY" && v.quarter == null) ctx.addIssue({ code: "custom", path: ["quarter"], message: "Choose a quarter" });
  });

export const affordabilitySchema = z.object({
  amount: moneyAmount,
  itemName: nullableText(120, "Item").optional(),
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const aiChatSchema = z.object({
  message: requiredText(2000, "Message"),
  conversationId: idField("Invalid conversation").optional(),
});

export const conversationUpdateSchema = z
  .object({
    title: requiredText(80, "Title").optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined, { message: "Nothing to update", path: ["title"] });

// ---------------------------------------------------------------------------
// Recurring rules (recurring transactions, bills, subscriptions)
// ---------------------------------------------------------------------------

export const RECURRING_KINDS = ["STANDARD", "BILL", "SUBSCRIPTION"] as const;
export const RECURRENCE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

const recurringFields = {
  kind: z.enum(RECURRING_KINDS).default("STANDARD"),
  name: requiredText(80, "Name"),
  type: z.enum(TRANSACTION_ENTRY_TYPES, { errorMap: () => ({ message: "Choose expense, income or transfer" }) }),
  amount: moneyAmount,
  accountId: idField("Select an account"),
  destinationAccountId: nullableIdField("Select an account").optional(),
  categoryId: nullableIdField("Select a category").optional(),
  merchant: nullableText(120, "Merchant").optional(),
  description: nullableText(240, "Description").optional(),
  notes: nullableText(1200, "Notes").optional(),
  frequency: z.enum(RECURRENCE_FREQUENCIES, { errorMap: () => ({ message: "Choose how often it repeats" }) }),
  interval: z.coerce.number().int().min(1, "Repeat interval must be at least 1").max(60).default(1),
  startDate: isoDate,
  endDate: nullableIsoDate.optional(),
  /** Explicit opt-in: record the transaction automatically when it falls due. */
  autoCreate: z.boolean().default(false),
  autopay: z.boolean().default(false),
  reminderDaysBefore: z.coerce.number().int().min(0).max(60).default(3),
};

export function recurringShapeIssues(v: TransactionShape & { kind?: string; startDate?: string | null; endDate?: string | null }): FieldIssue[] {
  const issues = transactionShapeIssues(v);
  if ((v.kind === "BILL" || v.kind === "SUBSCRIPTION") && v.type !== "EXPENSE") {
    issues.push({ path: ["type"], message: "Bills and subscriptions are expenses" });
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    issues.push({ path: ["endDate"], message: "End date must be on or after the start date" });
  }
  return issues;
}

export const recurringCreateSchema = z.object(recurringFields).superRefine((v, ctx) => {
  for (const issue of recurringShapeIssues(v)) ctx.addIssue({ code: "custom", ...issue });
});
export type RecurringCreateInput = z.infer<typeof recurringCreateSchema>;

export const recurringUpdateSchema = z.object({
  version: recordVersion,
  name: recurringFields.name.optional(),
  type: recurringFields.type.optional(),
  amount: moneyAmount.optional(),
  accountId: idField("Select an account").optional(),
  destinationAccountId: recurringFields.destinationAccountId,
  categoryId: recurringFields.categoryId,
  merchant: recurringFields.merchant,
  description: recurringFields.description,
  notes: recurringFields.notes,
  frequency: recurringFields.frequency.optional(),
  interval: z.coerce.number().int().min(1).max(60).optional(),
  startDate: isoDate.optional(),
  endDate: recurringFields.endDate,
  autoCreate: z.boolean().optional(),
  autopay: z.boolean().optional(),
  reminderDaysBefore: z.coerce.number().int().min(0).max(60).optional(),
});
export type RecurringUpdateInput = z.infer<typeof recurringUpdateSchema>;

export const recurringStateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), version: recordVersion }),
  z.object({
    action: z.literal("resume"),
    version: recordVersion,
    /** What to do with occurrences that fell due while paused. */
    missed: z.enum(["skip", "record"]).default("skip"),
  }),
  z.object({ action: z.literal("cancel"), version: recordVersion }),
]);

export const recurringQuerySchema = z.object({
  kind: z.enum(RECURRING_KINDS).optional(),
  includeInactive: queryBoolean.optional(),
});

export const occurrenceSettleSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    accountId: idField("Select an account").optional(),
    amount: moneyAmount.optional(),
    transactionDate: isoDate.optional(),
  }),
  z.object({
    mode: z.literal("link"),
    transactionId: idField("Choose a transaction"),
  }),
]);

export const occurrenceUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("unskip") }),
  /** "This occurrence only": a different amount for one date. */
  z.object({ action: z.literal("override"), amount: moneyAmount }),
  z.object({ action: z.literal("retry") }),
]);


// ---------------------------------------------------------------------------
// Merchants, rules, templates
// ---------------------------------------------------------------------------

export const merchantSchema = z.object({
  name: requiredText(80, "Merchant name"),
  defaultCategoryId: nullableIdField("Choose a category").optional(),
  aliases: z.array(z.string().trim().min(2, "Aliases need at least 2 characters").max(80)).max(30).default([]),
});

export const merchantUpdateSchema = merchantSchema.partial();

const ruleFields = {
  name: requiredText(80, "Rule name"),
  priority: z.coerce.number().int().min(1).max(1000).default(100),
  active: z.boolean().default(true),
  mode: z.enum(["SUGGEST", "AUTO"]).default("SUGGEST"),
  matchMerchant: nullableText(80, "Merchant contains").optional(),
  matchDescription: nullableText(80, "Description contains").optional(),
  minAmount: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
  maxAmount: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
  matchAccountId: nullableIdField("Choose an account").optional(),
  matchType: z.enum(["EXPENSE", "INCOME"]).nullable().optional(),
  setCategoryId: nullableIdField("Choose a category").optional(),
  addTags: tagList.default([]),
  setMerchantName: nullableText(80, "Merchant name").optional(),
  descriptionTemplate: nullableText(120, "Description").optional(),
};

export function ruleShapeIssues(v: {
  matchMerchant?: string | null;
  matchDescription?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  matchAccountId?: string | null;
  setCategoryId?: string | null;
  addTags?: string[];
  setMerchantName?: string | null;
  descriptionTemplate?: string | null;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!v.matchMerchant && !v.matchDescription && v.minAmount == null && v.maxAmount == null && !v.matchAccountId) {
    issues.push({ path: ["matchMerchant"], message: "Add at least one condition" });
  }
  if (!v.setCategoryId && !(v.addTags && v.addTags.length) && !v.setMerchantName && !v.descriptionTemplate) {
    issues.push({ path: ["setCategoryId"], message: "Add at least one action" });
  }
  if (v.minAmount != null && v.maxAmount != null && v.minAmount > v.maxAmount) {
    issues.push({ path: ["maxAmount"], message: "Maximum must be at least the minimum" });
  }
  return issues;
}

export const ruleCreateSchema = z.object(ruleFields).superRefine((v, ctx) => {
  for (const issue of ruleShapeIssues(v)) ctx.addIssue({ code: "custom", ...issue });
});
export type RuleInput = z.infer<typeof ruleCreateSchema>;

export const ruleApplySchema = z.object({
  /** Only uncategorised transactions by default; user data is never overwritten silently. */
  scope: z.enum(["uncategorized", "all"]).default("uncategorized"),
  dryRun: z.boolean().default(true),
});

export const suggestionQuerySchema = z.object({
  merchant: nullableText(120, "Merchant").optional(),
  description: nullableText(240, "Description").optional(),
  amount: z.coerce.number().positive().optional(),
  accountId: idField().optional(),
  type: z.enum(["EXPENSE", "INCOME"]).optional(),
});

export const templateSchema = z.object({
  name: requiredText(40, "Name"),
  type: z.enum(TRANSACTION_ENTRY_TYPES),
  amount: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
  accountId: nullableIdField("Choose an account").optional(),
  destinationAccountId: nullableIdField("Choose an account").optional(),
  categoryId: nullableIdField("Choose a category").optional(),
  merchant: nullableText(120, "Merchant").optional(),
  description: nullableText(240, "Description").optional(),
  tags: tagList.default([]),
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export const reconciliationStartSchema = z.object({
  accountId: idField("Choose an account"),
  statementDate: isoDate,
  /** Signed like the account balance (a card statement owing 5,000 is -5000). */
  statementBalance: signedMoney,
});

export const reconciliationCompleteSchema = z.object({
  /** Record a dated adjustment for the remaining difference (explicit consent). */
  createAdjustment: z.boolean().default(false),
  reason: nullableText(240, "Reason").optional(),
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const IMPORT_DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD MMM YYYY", "DD/MM/YY", "DD-MMM-YY", "DD.MM.YYYY"] as const;

export const importMappingConfig = z.object({
  date: z.string().min(1, "Map the date column"),
  description: z.string().nullable().optional(),
  merchant: z.string().nullable().optional(),
  amount: z.string().nullable().optional(),
  debit: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  dateFormat: z.enum(IMPORT_DATE_FORMATS),
  /** SIGNED: negative = money out. DEBIT_CREDIT: two columns. TYPE_COLUMN: amount + Dr/Cr column. */
  amountMode: z.enum(["SIGNED", "DEBIT_CREDIT", "TYPE_COLUMN"]),
  /** For SIGNED: whether a positive number means money out (some card exports). */
  positiveIsExpense: z.boolean().default(false),
});
export type ImportMappingConfig = z.infer<typeof importMappingConfig>;

export const importPreviewSchema = z.object({
  accountId: idField("Choose the account this statement belongs to"),
  fileName: z.string().trim().min(1).max(200),
  fileHash: z.string().trim().min(8).max(128),
  mapping: importMappingConfig,
  headers: z.array(z.string().max(120)).max(60),
  rows: z
    .array(z.array(z.string().max(1000)).max(60))
    .min(1, "The file has no data rows")
    .max(5000, "Import at most 5,000 rows at a time"),
});

export const importDecisionSchema = z.object({
  rowIndex: z.number().int().min(0),
  action: z.enum(["import", "skip"]),
  categoryId: nullableIdField("Choose a category").optional(),
  /** Classify a row as a transfer (e.g. card payment) to another of your accounts. */
  transferAccountId: nullableIdField("Choose an account").optional(),
});

export const importConfirmSchema = z.object({
  decisions: z.array(importDecisionSchema).max(5000),
});

export const importMappingSaveSchema = z.object({
  name: requiredText(60, "Preset name"),
  config: importMappingConfig,
});

// ---------------------------------------------------------------------------
// Planning & review
// ---------------------------------------------------------------------------

export const whatIfSchema = z.object({
  oneTimeExpense: z.preprocess((v) => (v === "" ? null : v), moneyAmount.nullable()).optional(),
  oneTimeExpenseLabel: nullableText(80, "Label").optional(),
  monthlyExpenseChange: z.preprocess((v) => (v === "" ? null : v), signedMoney.nullable()).optional(),
  monthlyIncomeChange: z.preprocess((v) => (v === "" ? null : v), signedMoney.nullable()).optional(),
  monthlySavingsIncrease: z.preprocess((v) => (v === "" ? null : v), signedMoney.nullable()).optional(),
  months: z.coerce.number().int().min(1).max(36).default(12),
  explain: z.boolean().default(false),
});

export const reviewMarkSchema = z.object({
  periodStart: isoDate,
  notes: nullableText(2000, "Notes").optional(),
});

export const cashFlowQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(180).default(45),
  includeExpectedIncome: queryBoolean.optional(),
});
