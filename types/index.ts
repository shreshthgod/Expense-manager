export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER";
export type BudgetPeriod = "MONTHLY" | "WEEKLY" | "YEARLY" | "CUSTOM";
export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type AccountType =
  | "CASH"
  | "BANK"
  | "SAVINGS"
  | "CREDIT_CARD"
  | "WALLET"
  | "INVESTMENT"
  | "LOAN"
  | "OTHER_ASSET"
  | "OTHER_LIABILITY";
export type SpendingClass = "ESSENTIAL" | "DISCRETIONARY";
export type CostBehavior = "FIXED" | "VARIABLE";
export type CategoryType = "EXPENSE" | "INCOME" | "BOTH";
export type NotificationType =
  | "BUDGET_THRESHOLD"
  | "BUDGET_EXCEEDED"
  | "GOAL_DEADLINE"
  | "UNUSUAL_TRANSACTION"
  | "RECURRING_UPCOMING"
  | "AI_RECOMMENDATION"
  | "REPORT_GENERATED";
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
export type ReportType =
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY"
  | "SPENDING_ANALYSIS"
  | "BUDGET"
  | "SAVINGS"
  | "FINANCIAL_HEALTH";

export type AIIntent =
  | "NET_WORTH_ANALYSIS"
  | "SPENDING_ANALYSIS"
  | "AFFORDABILITY_ANALYSIS"
  | "REPORT_GENERATION"
  | "BUDGET_ANALYSIS"
  | "GOAL_ANALYSIS"
  | "SAVINGS_ADVICE"
  | "SUBSCRIPTION_ANALYSIS"
  | "GENERAL_QUESTION";

export type Confidence = "high" | "medium" | "low";

export interface ApiFieldError {
  path: (string | number)[];
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string; details?: ApiFieldError[] };
  meta?: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  total: number;
  percentage: number;
  count: number;
}

export interface TrendPoint {
  label: string;
  date: string;
  expenses: number;
  income: number;
  savings: number;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  savingsRate: number;
  transactionCount: number;
  previous: {
    totalIncome: number;
    totalExpenses: number;
    netSavings: number;
    savingsRate: number;
  };
  changes: {
    incomePct: number | null;
    expensesPct: number | null;
    savingsPct: number | null;
    savingsRateDelta: number | null;
  };
}

export interface BudgetStatus {
  id: string;
  name: string;
  amount: number;
  period: BudgetPeriod;
  startDate: string;
  endDate: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  spent: number;
  remaining: number;
  utilization: number;
}

export interface GoalStatus {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  progressPct: number;
  deadline: string | null;
  daysRemaining: number | null;
  overdue: boolean;
  requiredMonthlySaving: number | null;
  category: string | null;
  description: string | null;
}

export interface Anomaly {
  transactionId: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  categoryName: string | null;
  transactionDate: string;
  reason: string;
  ratio: number;
}

export interface Recommendation {
  title: string;
  detail: string;
  reason: string;
  evidence: string[];
  expectedImpact: string;
  confidence: Confidence;
}

export interface AgentChatResponse {
  conversationId: string;
  intent: AIIntent;
  summary: string;
  findings: string[];
  recommendations: Recommendation[];
  evidence: { label: string; value: string }[];
  confidence: Confidence;
  usedAI: boolean;
  toolsRun: string[];
  reportId?: string;
  /**
   * Proposed actions, derived deterministically from tool data. Nothing is
   * executed by the assistant: the user confirms each one in the UI, which then
   * calls the normal API.
   */
  actions?: ProposedAction[];
}

export type ProposedAction =
  | { kind: "create_budget"; label: string; reason: string; payload: { name: string; categoryId: string; amount: number; period: "MONTHLY"; startDate: string } }
  | { kind: "open"; label: string; reason: string; href: string };
