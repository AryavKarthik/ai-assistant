import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/auth/api";
import {
  getProactiveNotification,
  updateNotificationStatus,
} from "@/lib/db/proactive-notifications";
import type { ProactiveNotificationStatus } from "@/lib/proactive/types";

const VALID_ACTIONS = new Set(["read", "dismiss", "snooze_1h", "snooze_tomorrow"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withAuthRoute(async ({ user }) => {
    const body = (await request.json()) as { action?: string };
    const action = body.action;

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const existing = await getProactiveNotification(user.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let status: ProactiveNotificationStatus = existing.status;
    let snoozedUntil: string | null = existing.snoozed_until;

    if (action === "read") {
      status = "read";
      snoozedUntil = null;
    } else if (action === "dismiss") {
      status = "dismissed";
      snoozedUntil = null;
    } else if (action === "snooze_1h") {
      status = "snoozed";
      snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    } else if (action === "snooze_tomorrow") {
      status = "snoozed";
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      snoozedUntil = tomorrow.toISOString();
    }

    const notification = await updateNotificationStatus(
      user.id,
      id,
      status,
      snoozedUntil,
    );

    return NextResponse.json({ notification });
  });
}
