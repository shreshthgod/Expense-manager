import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { notificationQuerySchema } from "@/lib/validation/schemas";
import { listNotifications, markAllNotificationsRead } from "@/server/services/notification.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const q = notificationQuerySchema.parse(searchParamsObject(request));
  return ok(await listNotifications(userId, q));
});

/** Mark all as read (the single "read all" endpoint). */
export const PATCH = withAuth(async ({ userId }) => {
  const updated = await markAllNotificationsRead(userId);
  return ok({ updated }, "All notifications marked as read");
});
