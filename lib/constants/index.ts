import type { AccountType } from "@/types";

export * from "./categories";

export type AccountGroup = "ASSET" | "LIABILITY";

export interface AccountTypeMeta {
  value: AccountType;
  label: string;
  group: AccountGroup;
  /** Counts toward "liquid" money (cash you can spend today). */
  liquid: boolean;
  icon: string;
}

export const ACCOUNT_TYPES: readonly AccountTypeMeta[] = [
  { value: "BANK", label: "Bank account", group: "ASSET", liquid: true, icon: "Landmark" },
  { value: "SAVINGS", label: "Savings account", group: "ASSET", liquid: true, icon: "PiggyBank" },
  { value: "CASH", label: "Cash", group: "ASSET", liquid: true, icon: "Banknote" },
  { value: "WALLET", label: "Wallet / UPI", group: "ASSET", liquid: true, icon: "Wallet" },
  { value: "INVESTMENT", label: "Investment", group: "ASSET", liquid: false, icon: "TrendingUp" },
  { value: "OTHER_ASSET", label: "Other asset", group: "ASSET", liquid: false, icon: "Gem" },
  { value: "CREDIT_CARD", label: "Credit card", group: "LIABILITY", liquid: false, icon: "CreditCard" },
  { value: "LOAN", label: "Loan", group: "LIABILITY", liquid: false, icon: "HandCoins" },
  { value: "OTHER_LIABILITY", label: "Other liability", group: "LIABILITY", liquid: false, icon: "Scale" },
];

export const ACCOUNT_TYPE_VALUES = ACCOUNT_TYPES.map((t) => t.value) as [AccountType, ...AccountType[]];

export function accountTypeMeta(type: AccountType): AccountTypeMeta {
  return ACCOUNT_TYPES.find((t) => t.value === type) ?? ACCOUNT_TYPES[0]!;
}

export function isLiabilityType(type: AccountType): boolean {
  return accountTypeMeta(type).group === "LIABILITY";
}

export const PAYMENT_METHODS = [
  "UPI",
  "Credit Card",
  "Debit Card",
  "Net Banking",
  "Cash",
  "Wallet",
] as const;

export const BUDGET_ALERT_THRESHOLDS = [50, 75, 90, 100] as const;

export const GOAL_CATEGORY_OPTIONS = [
  "Emergency Fund",
  "Electronics",
  "Vacation",
  "Vehicle",
  "Education",
  "Home",
  "Investment",
  "Other",
] as const;

export const SUPPORTED_CURRENCIES = [
  { code: "INR", label: "Indian Rupee (₹)", locale: "en-IN" },
  { code: "USD", label: "US Dollar ($)", locale: "en-US" },
  { code: "EUR", label: "Euro (€)", locale: "en-IE" },
  { code: "GBP", label: "British Pound (£)", locale: "en-GB" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export const DATE_FORMATS = ["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD/MM/YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const CHART_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f97316",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#ef4444",
  "#06b6d4",
  "#a855f7",
  "#6366f1",
  "#84cc16",
];

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export const APP_NAME = "Expense Manager";
export const APP_VERSION = "2.0.0";
export const APP_TAGLINE = "Understand your money. Control your future.";
