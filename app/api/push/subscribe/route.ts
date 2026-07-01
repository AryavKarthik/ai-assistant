import { authJson } from "@/lib/auth/api";
import { upsertPushSubscription } from "@/lib/db/push-subscriptions";

interface SubscribeBody {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export async function POST(request: Request) {
  return authJson(async ({ user }) => {
    const body = (await request.json()) as SubscribeBody;

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      throw new Error("Invalid push subscription payload");
    }

    await upsertPushSubscription(user.id, {
      endpoint: body.endpoint,
      keys: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return { success: true };
  });
}
