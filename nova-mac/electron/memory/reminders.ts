import { getSupabase } from "../supabase";
import type { Reminder } from "./types";

export async function listUpcomingReminders(
  userId: string,
  limit = 5,
): Promise<Reminder[]> {
  const { data, error } = await getSupabase()
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export function formatReminderLine(reminder: Pick<Reminder, "title" | "due_at">): string {
  if (!reminder.due_at) return `- [reminder] ${reminder.title}`;
  const date = new Date(reminder.due_at);
  const label = date.toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
  return `- [reminder] ${reminder.title} — due ${label}`;
}
