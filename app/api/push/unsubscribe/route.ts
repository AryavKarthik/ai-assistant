import { authJson } from "@/lib/auth/api";
import { deletePushSubscription } from "@/lib/db/push-subscriptions";

export async function DELETE(request: Request) {
  return authJson(async ({ user }) => {
    const body = (await request.json()) as { endpoint?: string };

    if (!body.endpoint) {
      throw new Error("Missing endpoint");
    }

    await deletePushSubscription(user.id, body.endpoint);
    return { success: true };
  });
}
