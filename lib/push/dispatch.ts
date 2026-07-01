import {
  deletePushSubscription,
  listPushSubscriptions,
} from "@/lib/db/push-subscriptions";
import {
  listDueUnnotifiedReminders,
  markReminderNotified,
} from "@/lib/db/reminders";
import { sendPushNotification } from "@/lib/push/send";
import { isPushConfigured } from "@/lib/push/vapid";

export interface DispatchedReminder {
  id: string;
  title: string;
}

export interface DispatchDueResult {
  notifiedCount: number;
  notified: DispatchedReminder[];
}

function formatDueLabel(dueAt: string | null): string {
  if (!dueAt) return "Due now";
  return `Due ${new Date(dueAt).toLocaleString()}`;
}

export async function dispatchDueReminderNotifications(
  userId?: string,
): Promise<DispatchDueResult> {
  const notified: DispatchedReminder[] = [];

  const dueReminders = await listDueUnnotifiedReminders(userId);

  for (const reminder of dueReminders) {
    const subscriptions = isPushConfigured()
      ? await listPushSubscriptions(reminder.user_id)
      : [];

    if (subscriptions.length === 0) {
      console.log(`[push] no subscriptions for reminder ${reminder.id}, skipping`);
      continue;
    }

    let anySent = false;
    for (const subscription of subscriptions) {
      try {
        const result = await sendPushNotification(subscription, {
          title: "Reminder due",
          body: `${reminder.title} — ${formatDueLabel(reminder.due_at)}`,
          url: "/reminders",
        });

        if (result === "gone") {
          await deletePushSubscription(reminder.user_id, subscription.endpoint);
        } else {
          anySent = true;
        }
      } catch (error) {
        console.error("[push] send failed:", error);
      }
    }

    if (anySent) {
      await markReminderNotified(reminder.id);
      notified.push({ id: reminder.id, title: reminder.title });
    }
  }

  return { notifiedCount: notified.length, notified };
}
