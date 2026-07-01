import webpush from "web-push";
import type { PushSubscriptionRow } from "@/lib/db/push-subscriptions";
import {
  getVapidPrivateKey,
  getVapidPublicKey,
  getVapidSubject,
} from "@/lib/push/vapid";

let configured = false;

function ensureVapidConfigured(): void {
  if (configured) return;
  webpush.setVapidDetails(
    getVapidSubject(),
    getVapidPublicKey(),
    getVapidPrivateKey(),
  );
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type?: string;
  notificationId?: string;
}

function rowToWebPushSubscription(row: PushSubscriptionRow) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

export async function sendPushNotification(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<"sent" | "gone"> {
  ensureVapidConfigured();

  try {
    await webpush.sendNotification(
      rowToWebPushSubscription(subscription),
      JSON.stringify(payload),
    );
    return "sent";
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode?: number }).statusCode
        : undefined;

    if (statusCode === 404 || statusCode === 410) {
      console.warn("[push] subscription expired:", subscription.endpoint);
      return "gone";
    }

    throw error;
  }
}
