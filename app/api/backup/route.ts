import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { todayISO } from "@/lib/dates/date-only";
import { exportBackup } from "@/server/services/backup.service";

export const runtime = "nodejs";

/** Downloads a complete JSON backup of the user's financial data. */
export const GET = withAuth(async ({ userId }) => {
  await enforceRateLimit(`backup:export:${userId}`, 5, 60_000);
  const backup = await exportBackup(userId);
  return new NextResponse(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="expense-manager-backup-${todayISO()}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
