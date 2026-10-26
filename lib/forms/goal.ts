import type { GoalKindValue, GoalStatus } from "@/server/services/goal.service";

export interface GoalFormState {
  name: string;
  kind: GoalKindValue;
  targetAmount: string;
  currentAmount: string;
  deadline: string;
  category: string;
  description: string;
  /** "" = not linked to an account. */
  accountId: string;
  monthlyContribution: string;
  repeatsYearly: boolean;
}

export function emptyGoalForm(kind: GoalKindValue = "SAVINGS"): GoalFormState {
  return {
    name: "",
    kind,
    targetAmount: "",
    currentAmount: "",
    deadline: "",
    category: "",
    description: "",
    accountId: "",
    monthlyContribution: "",
    repeatsYearly: kind === "SINKING_FUND",
  };
}

export function goalFormFromStatus(g: GoalStatus): GoalFormState {
  return {
    name: g.name,
    kind: g.kind,
    targetAmount: String(g.targetAmount),
    currentAmount: String(g.currentAmount),
    deadline: g.deadline ?? "",
    category: g.category ?? "",
    description: g.description ?? "",
    accountId: g.accountId ?? "",
    monthlyContribution: g.monthlyContribution != null ? String(g.monthlyContribution) : "",
    repeatsYearly: g.repeatsYearly,
  };
}

const money = (v: string) => v.replace(/,/g, "").trim();

/** Optional fields are sent as explicit nulls; an empty deadline clears it. */
export function buildGoalCreateBody(s: GoalFormState) {
  return {
    name: s.name.trim(),
    kind: s.kind,
    targetAmount: money(s.targetAmount),
    currentAmount: money(s.currentAmount) || "0",
    deadline: s.deadline || null,
    category: s.category.trim() || null,
    description: s.description.trim() || null,
    accountId: s.accountId || null,
    monthlyContribution: money(s.monthlyContribution) || null,
    repeatsYearly: s.kind === "SINKING_FUND" ? s.repeatsYearly : false,
  };
}

/** The saved amount is changed through contributions, never by editing the goal. */
export function buildGoalUpdateBody(s: GoalFormState, version: number) {
  const { currentAmount: _saved, ...rest } = buildGoalCreateBody(s);
  return { ...rest, version };
}
