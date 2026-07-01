import {
  deletePushSubscription,
  listPushSubscriptions,
} from "@/lib/db/push-subscriptions";
import { sendPushNotification, type PushPayload } from "@/lib/push/send";
import { isPushConfigured } from "@/lib/push/vapid";

export async function sendProactivePush(
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!isPushConfigured()) return 0;

  const subscriptions = await listPushSubscriptions(userId);
  let sent = 0;

  for (const subscription of subscriptions) {
    try {
      const result = await sendPushNotification(subscription, payload);
      if (result === "gone") {
        await deletePushSubscription(userId, subscription.endpoint);
      } else {
        sent++;
      }
    } catch (error) {
      console.error("[proactive push] send failed:", error);
    }
  }

  return sent;
}
