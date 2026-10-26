import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, lastDayOf, parseISODate, startOfWeek, type DateRange, type ISODate } from "@/lib/dates/date-only";
import { round2 } from "@/lib/utils/money";
import { totalsForWindows } from "@/server/analytics/definitions";
import { trailingMonths, type PeriodSettings } from "@/server/analytics/ranges";

export interface TrendPoint {
  label: string;
  start: ISODate;
  end: ISODate;
  income: number;
  /** Net spending (expenses − refunds). */
  expenses: number;
  /** income − net spending. */
  surplus: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(range: DateRange, monthStartDay: number): string {
  // Payday cycles are labelled by the month in which they end.
  const ref = monthStartDay > 1 ? lastDayOf(range) : range.start;
  const { year, month } = parseISODate(ref);
  return `${MONTHS[month - 1]} ${String(year).slice(2)}`;
}

export async function getMonthlyTrend(userId: string, today: ISODate, months: number, settings: PeriodSettings): Promise<TrendPoint[]> {
  const ranges = trailingMonths(today, months, settings);
  const totals = await totalsForWindows(
    userId,
    ranges.map((range, i) => ({ key: String(i), range }))
  );
  return ranges.map((range, i) => {
    const t = totals.get(String(i))!;
    return { label: monthLabel(range, settings.monthStartDay), ...range, income: t.income, expenses: t.netSpending, surplus: t.surplus };
  });
}

export async function getDailyTrend(userId: string, range: DateRange): Promise<TrendPoint[]> {
  const rows = await prisma.$queryRaw<{ day: Date; income: Prisma.Decimal; expense: Prisma.Decimal }[]>`
    SELECT d::date AS day,
      COALESCE(SUM(t."amount") FILTER (WHERE t."type"::text = 'INCOME'), 0) AS income,
      COALESCE(SUM(CASE WHEN t."type"::text = 'EXPENSE' THEN t."amount" WHEN t."type"::text = 'REFUND' THEN -t."amount" END), 0) AS expense
    FROM generate_series(${range.start}::date, (${range.end}::date - 1), interval '1 day') AS d
    LEFT JOIN "Transaction" t
      ON t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
     AND t."transactionDate" = d::date
    GROUP BY d ORDER BY d
    LIMIT 400`;
  return rows.map((r) => {
    const day = fromDbDate(r.day);
    const { month, day: dd } = parseISODate(day);
    const income = round2(Number(r.income));
    const expenses = round2(Number(r.expense));
    return { label: `${dd} ${MONTHS[month - 1]}`, start: day, end: addDays(day, 1), income, expenses, surplus: round2(income - expenses) };
  });
}

export async function getWeeklyTrend(userId: string, range: DateRange, weekStartsOn: number): Promise<TrendPoint[]> {
  const windows: { key: string; range: DateRange }[] = [];
  let cursor = startOfWeek(range.start, weekStartsOn);
  while (cursor < range.end && windows.length < 60) {
    windows.push({ key: cursor, range: { start: cursor, end: addDays(cursor, 7) } });
    cursor = addDays(cursor, 7);
  }
  const totals = await totalsForWindows(userId, windows);
  return windows.map((w) => {
    const t = totals.get(w.key)!;
    const { month, day } = parseISODate(w.range.start);
    return { label: `W/C ${day} ${MONTHS[month - 1]}`, ...w.range, income: t.income, expenses: t.netSpending, surplus: t.surplus };
  });
}
