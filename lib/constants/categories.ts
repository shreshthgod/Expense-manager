import type { CategoryType } from "@/types";

/**
 * Default category TEMPLATES.
 *
 * These are *not* runtime category values. Every user gets their own copy of each
 * template as a database row via `ensureSystemCategories(userId)`, and the UI must
 * always select categories by their database id (fetched from `/api/categories`).
 * Never use `template.name` as a `categoryId` — that exact mistake broke every
 * transaction/budget form in v1 (KNOWN_ISSUES B1/B2/B4/B8).
 *
 * Keep in sync with the `_cat_tpl` VALUES list in
 * prisma/migrations/0002_core_repair/migration.sql.
 */
export interface CategoryTemplate {
  name: string;
  icon: string;
  color: string;
  type: CategoryType;
  spendingClass: "ESSENTIAL" | "DISCRETIONARY" | null;
  costBehavior: "FIXED" | "VARIABLE" | null;
}

export const DEFAULT_CATEGORIES: readonly CategoryTemplate[] = [
  { name: "Food", icon: "UtensilsCrossed", color: "#f97316", type: "EXPENSE", spendingClass: "DISCRETIONARY", costBehavior: "VARIABLE" },
  { name: "Groceries", icon: "ShoppingBasket", color: "#22c55e", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "VARIABLE" },
  { name: "Transport", icon: "Car", color: "#3b82f6", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "VARIABLE" },
  { name: "Shopping", icon: "ShoppingBag", color: "#ec4899", type: "EXPENSE", spendingClass: "DISCRETIONARY", costBehavior: "VARIABLE" },
  { name: "Entertainment", icon: "Popcorn", color: "#a855f7", type: "EXPENSE", spendingClass: "DISCRETIONARY", costBehavior: "VARIABLE" },
  { name: "Bills", icon: "ReceiptText", color: "#64748b", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "FIXED" },
  { name: "Rent", icon: "Home", color: "#14b8a6", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "FIXED" },
  { name: "Utilities", icon: "Lightbulb", color: "#eab308", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "VARIABLE" },
  { name: "Household", icon: "Sofa", color: "#a16207", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "VARIABLE" },
  { name: "Healthcare", icon: "HeartPulse", color: "#ef4444", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "VARIABLE" },
  { name: "Education", icon: "GraduationCap", color: "#6366f1", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "FIXED" },
  { name: "Travel", icon: "Plane", color: "#06b6d4", type: "EXPENSE", spendingClass: "DISCRETIONARY", costBehavior: "VARIABLE" },
  { name: "Subscriptions", icon: "Repeat", color: "#8b5cf6", type: "EXPENSE", spendingClass: "DISCRETIONARY", costBehavior: "FIXED" },
  { name: "Personal Care", icon: "Sparkles", color: "#f43f5e", type: "EXPENSE", spendingClass: "DISCRETIONARY", costBehavior: "VARIABLE" },
  { name: "Insurance", icon: "ShieldCheck", color: "#0ea5e9", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "FIXED" },
  { name: "EMI & Loans", icon: "Landmark", color: "#475569", type: "EXPENSE", spendingClass: "ESSENTIAL", costBehavior: "FIXED" },
  { name: "Investment", icon: "TrendingUp", color: "#10b981", type: "EXPENSE", spendingClass: null, costBehavior: "VARIABLE" },
  { name: "Other", icon: "CircleEllipsis", color: "#94a3b8", type: "EXPENSE", spendingClass: null, costBehavior: "VARIABLE" },
  { name: "Salary", icon: "Briefcase", color: "#16a34a", type: "INCOME", spendingClass: null, costBehavior: null },
  { name: "Freelance", icon: "Laptop", color: "#0d9488", type: "INCOME", spendingClass: null, costBehavior: null },
  { name: "Business", icon: "Building2", color: "#2563eb", type: "INCOME", spendingClass: null, costBehavior: null },
  { name: "Interest", icon: "Percent", color: "#ca8a04", type: "INCOME", spendingClass: null, costBehavior: null },
  { name: "Gift", icon: "Gift", color: "#db2777", type: "INCOME", spendingClass: null, costBehavior: null },
  { name: "Other Income", icon: "Banknote", color: "#15803d", type: "INCOME", spendingClass: null, costBehavior: null },
];

/** Palette offered when creating custom categories. */
export const CATEGORY_COLOR_OPTIONS = [
  "#f97316", "#22c55e", "#3b82f6", "#ec4899", "#a855f7", "#64748b", "#14b8a6", "#eab308",
  "#a16207", "#ef4444", "#6366f1", "#06b6d4", "#8b5cf6", "#f43f5e", "#0ea5e9", "#475569",
  "#10b981", "#94a3b8",
] as const;

/** Lucide icon names offered when creating custom categories. */
export const CATEGORY_ICON_OPTIONS = [
  "UtensilsCrossed", "ShoppingBasket", "Car", "ShoppingBag", "Popcorn", "ReceiptText", "Home",
  "Lightbulb", "Sofa", "HeartPulse", "GraduationCap", "Plane", "Repeat", "Sparkles", "ShieldCheck",
  "Landmark", "TrendingUp", "CircleEllipsis", "Briefcase", "Laptop", "Building2", "Percent", "Gift",
  "Banknote", "Coffee", "Fuel", "Baby", "Dog", "Dumbbell", "Gamepad2", "Music", "Shirt", "Smartphone",
  "Wifi", "Wrench", "PiggyBank", "HandCoins", "Tag",
] as const;
