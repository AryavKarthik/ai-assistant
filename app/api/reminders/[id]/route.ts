import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import {
  completeReminder,
  deleteReminder,
  updateReminder,
  updateReminderForMemory,
} from "@/lib/db/reminders";
import type { ReminderStatus } from "@/lib/supabase/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    return await withAuth(async ({ user }) => {
      const userId = user.id;

      if (body.status === "done") {
        const reminder = await completeReminder(userId, id);
        return NextResponse.json({
          reminder: {
            id: reminder.id,
            title: reminder.title,
            due_at: reminder.due_at,
            status: reminder.status,
            created_at: reminder.created_at,
          },
        });
      }

      const title =
        typeof body.title === "string" ? body.title.trim() : undefined;
      const due_at =
        typeof body.due_at === "string"
          ? body.due_at
          : body.due_at === null
            ? null
            : undefined;
      const status =
        body.status === "pending" ||
        body.status === "done" ||
        body.status === "cancelled"
          ? (body.status as ReminderStatus)
          : undefined;
      const forMemory = body.forMemory === true;

      if (!title && due_at === undefined && !status) {
        return NextResponse.json(
          { error: "Provide status, title, or due_at to update" },
          { status: 400 },
        );
      }

      const reminder = forMemory
        ? await updateReminderForMemory(userId, id, {
            ...(title ? { title } : {}),
            ...(due_at !== undefined ? { due_at } : {}),
            ...(status ? { status } : {}),
          })
        : await updateReminder(userId, id, {
            ...(title ? { title } : {}),
            ...(due_at !== undefined ? { due_at } : {}),
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
    console.error("PATCH /api/reminders/[id] error:", error);
    const err = error as { code?: string; message?: string };
    if (err.code === "PGRST204" && err.message?.includes("completed_at")) {
      return NextResponse.json(
        {
          error:
            "Database missing completed_at column. Run supabase/migrations/003_reminder_lifecycle.sql in Supabase SQL editor.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update reminder" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await withAuth(async ({ user }) => {
      const deleted = await deleteReminder(user.id, id);
      if (!deleted) {
        return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error("DELETE /api/reminders/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete reminder" },
      { status: 500 },
    );
  }
}
