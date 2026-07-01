import { NextResponse } from "next/server";
import { deleteStaleCompletedReminders } from "@/lib/db/reminders";
import { dispatchDueReminderNotifications } from "@/lib/push/dispatch";

async function handleCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchDueReminderNotifications();

    let deletedCompletedReminders = 0;
    try {
      deletedCompletedReminders = await deleteStaleCompletedReminders();
    } catch (cleanupError) {
      console.error("Reminder cleanup error (push dispatch succeeded):", cleanupError);
    }

    return NextResponse.json({
      ok: true,
      notifiedCount: result.notifiedCount,
      deletedCompletedReminders,
    });
  } catch (error) {
    console.error("Reminder cron error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
