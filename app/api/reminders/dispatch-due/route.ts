import { authJson } from "@/lib/auth/api";
import { dispatchDueReminderNotifications } from "@/lib/push/dispatch";

export async function POST() {
  return authJson(async ({ user }) => {
    const result = await dispatchDueReminderNotifications(user.id);
    return { ok: true, ...result };
  });
}
