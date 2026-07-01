import { authJson } from "@/lib/auth/api";
import { listActiveNotifications } from "@/lib/db/proactive-notifications";

export async function GET(request: Request) {
  return authJson(async ({ user }) => {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Number(searchParams.get("limit") ?? "50"),
      100,
    );

    const notifications = await listActiveNotifications(user.id, limit);
    const unreadCount = notifications.filter(
      (n) => n.status === "unread",
    ).length;

    return { notifications, unreadCount };
  });
}
