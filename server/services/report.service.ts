import type { Prisma, ReportType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { addDays, fromDbDate, toDbDate, type DateRange } from "@/lib/dates/date-only";
import { reportRange } from "@/server/analytics/ranges";
import { narrateReport, type ReportNarrative } from "@/agents/report-agent";
import { runInTransaction } from "@/server/db/idempotency";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { auditTx } from "@/server/services/audit.service";
import { buildReportDataset, type ReportDataset } from "@/server/services/report-data.service";

export interface GenerateReportInput {
  type: "MONTHLY" | "QUARTERLY" | "YEARLY";
  year: number;
  month?: number;
  quarter?: number;
}

export interface ReportSummaryDTO {
  id: string;
  type: ReportType;
  title: string;
  summary: string;
  healthScore: number | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  /** Underlying transactions changed after this snapshot was generated. */
  stale: boolean;
  usedAI: boolean;
}

export interface ReportContent {
  dataset: ReportDataset;
  narrative: ReportNarrative;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function reportTitle(input: GenerateReportInput): { title: string; label: string } {
  if (input.type === "MONTHLY" && input.month) {
    const label = `${MONTHS[input.month - 1]} ${input.year}`;
    return { title: `${label} Monthly Report`, label };
  }
  if (input.type === "QUARTERLY" && input.quarter) {
    const label = `Q${input.quarter} ${input.year}`;
    return { title: `${label} Quarterly Report`, label };
  }
  return { title: `${input.year} Yearly Report`, label: String(input.year) };
}

export function rangeFor(input: GenerateReportInput): DateRange {
  return reportRange(input);
}

/** Deterministic dataset first; narrative second (template when AI is off). */
export async function generateReport(userId: string, input: GenerateReportInput): Promise<ReportSummaryDTO> {
  const range = rangeFor(input);
  const { title, label } = reportTitle(input);
  const dataset = await buildReportDataset(userId, range, label);
  const narrative = await narrateReport(dataset);
  const content: ReportContent = { dataset, narrative };

  const eventIds: string[] = [];
  const result = await runInTransaction(userId, undefined, async (tx) => {
    const row = await tx.aIReport.create({
      data: {
        userId,
        type: input.type,
        startDate: toDbDate(range.start),
        endDate: toDbDate(addDays(range.end, -1)),
        title,
        summary: narrative.executiveSummary,
        content: content as unknown as Prisma.InputJsonValue,
        healthScore: dataset.healthScore.score,
        metadata: {
          usedAI: narrative.usedAI,
          formulaVersion: dataset.formulaVersion,
          schemaVersion: dataset.schemaVersion,
          timezone: dataset.timezone,
          transactionCount: dataset.totals.transactionCount,
        } as Prisma.InputJsonValue,
      },
    });
    await auditTx(tx, { userId, action: "REPORT_GENERATED", entity: "AIReport", entityId: row.id });
    eventIds.push(await enqueueEvent(tx, userId, "report.generated", { reportId: row.id, title }));
    return row.id;
  });
  await dispatchEvents(eventIds);
  const [summary] = await listReports(userId, [result.value]);
  return summary!;
}

export async function listReports(userId: string, ids?: string[]): Promise<ReportSummaryDTO[]> {
  const rows = await prisma.aIReport.findMany({
    where: { userId, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, title: true, summary: true, healthScore: true, startDate: true, endDate: true, createdAt: true, metadata: true },
  });
  if (rows.length === 0) return [];
  const staleRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r."id" FROM "AIReport" r
    WHERE r."userId" = ${userId}
      AND EXISTS (
        SELECT 1 FROM "Transaction" t
        WHERE t."userId" = r."userId" AND t."updatedAt" > r."createdAt"
          AND t."transactionDate" >= r."startDate" AND t."transactionDate" <= r."endDate"
      )`;
  const stale = new Set(staleRows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    summary: r.summary,
    healthScore: r.healthScore,
    startDate: fromDbDate(r.startDate),
    endDate: fromDbDate(r.endDate),
    createdAt: r.createdAt.toISOString(),
    stale: stale.has(r.id),
    usedAI: Boolean((r.metadata as { usedAI?: boolean } | null)?.usedAI),
  }));
}

export async function getReport(userId: string, id: string): Promise<ReportSummaryDTO & { content: ReportContent | null; legacy: boolean }> {
  const row = await prisma.aIReport.findFirst({ where: { id, userId } });
  if (!row) throw ApiError.notFound("Report not found");
  const [summary] = await listReports(userId, [id]);
  const content = row.content as unknown as Partial<ReportContent> | null;
  const isV2 = !!content && typeof content === "object" && "dataset" in content && !!content.dataset;
  return { ...summary!, content: isV2 ? (content as ReportContent) : null, legacy: !isV2 };
}

export async function deleteReport(userId: string, id: string): Promise<void> {
  await runInTransaction(userId, undefined, async (tx) => {
    const deleted = await tx.aIReport.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw ApiError.notFound("Report not found");
    await auditTx(tx, { userId, action: "REPORT_DELETED", entity: "AIReport", entityId: id });
  });
}
