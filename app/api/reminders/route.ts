import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import {
  insertReminder,
  listRemindersForTab,
  listReminders,
} from "@/lib/db/reminders";
import type { ReminderStatus } from "@/lib/supabase/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") ?? "pending") as
      | ReminderStatus
      | "all";
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100);
    const forTab = searchParams.get("forTab") === "true";

    return await withAuth(async ({ user }) => {
      const reminders = forTab
        ? await listRemindersForTab(user.id, limit)
        : await listReminders(user.id, { status, limit });

      return NextResponse.json({
        reminders: reminders.map((r) => ({
          id: r.id,
          title: r.title,
          due_at: r.due_at,
          status: r.status,
          created_at: r.created_at,
        })),
      });
    });
  } catch (error) {
    console.error("GET /api/reminders error:", error);
    return NextResponse.json(
      { error: "Failed to load reminders" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const due_at =
      typeof body.due_at === "string"
        ? body.due_at
        : body.due_at === null
          ? null
          : undefined;

    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 },
      );
    }

    return await withAuth(async ({ user }) => {
      const reminder = await insertReminder(user.id, {
        title,
        due_at: due_at ?? null,
      });

      return NextResponse.json({
        reminder: {
          id: reminder.id,
          title: reminder.title,
          due_at: reminder.due_at,
          status: reminder.status,
          created_at: reminder.created_at,
        },
      });
    });
  } catch (error) {
    console.error("POST /api/reminders error:", error);
    return NextResponse.json(
      { error: "Failed to create reminder" },
      { status: 500 },
    );
  }
}
