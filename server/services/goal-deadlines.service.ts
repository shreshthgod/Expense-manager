import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/utils/format";
import { logger } from "@/lib/observability/logger";
import { listGoals } from "@/server/services/goal.service";
import { notify } from "@/server/services/notification.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

const UPCOMING_WINDOW_DAYS = 14;
const MILESTONES = [25, 50, 75, 100] as const;

/**
 * Scheduler task: goal deadline reminders (≤ 14 days, once per goal+deadline)
 * and progress milestones (25/50/75/100 %, once each).
 */
export async function checkGoals(userId: string): Promise<number> {
  let sent = 0;
  try {
    const settings = await getUserSettings(userId);
    const goals = await listGoals(userId, todayFor(settings));
    for (const g of goals) {
      if (g.effectiveDeadline && !g.archived && g.daysRemaining != null && g.daysRemaining >= 1 && g.daysRemaining <= UPCOMING_WINDOW_DAYS && !g.completed) {
        const outcome = await notify({
          userId,
          type: "GOAL_DEADLINE",
          title: `Goal deadline approaching: ${g.name}`,
          message: `${g.daysRemaining} day(s) left and ${formatMoney(g.remainingAmount, settings.currency)} to go.`,
          link: `/goals?focus=${g.id}`,
          dedupeKey: `goal-deadline:${g.id}:${g.effectiveDeadline}`,
        });
        if (outcome === "created") sent += 1;
      }
      const reached = MILESTONES.filter((m) => g.progressPct >= m).pop();
      if (reached) {
        const outcome = await notify({
          userId,
          type: "GOAL_MILESTONE",
          title: reached === 100 ? `Goal reached: ${g.name}` : `${g.name} is ${reached}% funded`,
          message: `${formatMoney(g.currentAmount, settings.currency)} of ${formatMoney(g.targetAmount, settings.currency)} saved.`,
          link: `/goals?focus=${g.id}`,
          dedupeKey: `goal-milestone:${g.id}:${reached}`,
        });
        if (outcome === "created") sent += 1;
      }
    }
  } catch (error) {
    logger.error("goals.check_failed", { userId, error });
  }
  return sent;
}

export async function checkAllGoals(): Promise<number> {
  const users = await prisma.savingsGoal.findMany({ distinct: ["userId"], select: { userId: true } });
  let sent = 0;
  for (const { userId } of users) sent += await checkGoals(userId);
  return sent;
}
