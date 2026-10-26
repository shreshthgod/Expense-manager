import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/utils/format";
import { describeFilter, parseNaturalFilter, type NaturalFilterParams } from "@/lib/finance/natural-filter";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/**
 * Natural-language → transactions filter ("food above 1000 last month").
 * Deterministic: the result is only a filter for the normal transactions API.
 */
export async function parseTransactionFilter(userId: string, text: string): Promise<{ matched: boolean; params: NaturalFilterParams; description: string }> {
  const settings = await getUserSettings(userId);
  const categories = await prisma.category.findMany({ where: { userId, archivedAt: null }, select: { id: true, name: true, type: true } });
  const filter = parseNaturalFilter(text, todayFor(settings), categories);
  if (!filter) return { matched: false, params: { search: text }, description: `Search for "${text}"` };
  return { matched: true, params: filter.params, description: describeFilter(filter, (n) => formatMoney(n, settings.currency)) };
}
