import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { notificationUpdateSchema } from "@/lib/validation/schemas";
import { deleteNotification, setNotificationRead } from "@/server/services/notification.service";

export const runtime = "nodejs";

/** Read state changes never delete (v1 bug B7). */
export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = notificationUpdateSchema.parse(await readJson(request));
  return ok(await setNotificationRead(userId, params.id, input.read));
});

/** Deleting is a separate, explicit action. */
export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteNotification(userId, params.id);
  return ok({ deleted: true }, "Notification deleted");
});
