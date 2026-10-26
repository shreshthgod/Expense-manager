import type { AIIntent } from "@/types";
import type { ParsedIntent } from "./intent-agent";

/**
 * Deterministic planner: maps an intent to an ordered list of tool calls.
 * The planner never touches the database — it only selects controlled tools.
 */
export function planTools(intent: AIIntent, parsed: ParsedIntent): string[] {
  switch (intent) {
    case "SPENDING_ANALYSIS":
      return [
        "get_user_financial_summary",
        "get_expenses_by_category",
        "compare_periods",
        "get_top_merchants",
        "detect_anomalies",
      ];
    case "NET_WORTH_ANALYSIS":
      return ["get_account_balances", "get_user_financial_summary"];
    case "AFFORDABILITY_ANALYSIS":
      return ["get_user_financial_summary", "calculate_affordability", "get_account_balances", "get_goal_status"];
    case "BUDGET_ANALYSIS":
      return ["get_budget_status", "get_expenses_by_category", "generate_spending_forecast"];
    case "GOAL_ANALYSIS":
      return ["get_goal_status", "calculate_savings_rate", "get_budget_status"];
    case "SAVINGS_ADVICE":
      return [
        "calculate_savings_rate",
        "get_expenses_by_category",
        "get_recurring_transactions",
        "get_budget_status",
      ];
    case "SUBSCRIPTION_ANALYSIS":
      return ["get_recurring_transactions", "get_expenses_by_category"];
    case "REPORT_GENERATION":
      return ["get_user_financial_summary", "get_budget_status", "get_goal_status"];
    default:
      return parsed.amount
        ? ["get_user_financial_summary", "calculate_affordability"]
        : ["get_user_financial_summary", "get_expenses_by_category", "get_account_balances"];
  }
}

export const MAX_TOOL_ITERATIONS = 5;
