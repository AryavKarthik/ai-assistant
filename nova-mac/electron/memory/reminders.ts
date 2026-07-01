import { getSupabase } from "../supabase";
import { getUserId } from "./client";
import type { Reminder } from "./types";
import type { ReminderItem } from "@shared/types";

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

export async function insertReminder(
  userId: string,
  input: { title: string; due_at?: string | null; source_message_id?: string },
): Promise<Reminder> {
  const { data, error } = await getSupabase()
    .from("reminders")
    .insert({ user_id: userId, title: input.title, due_at: input.due_at ?? null, source_message_id: input.source_message_id ?? null })
    .select("*").single();
  if (error) throw error;
  return data as Reminder;
}

export async function listReminders(
  userId: string,
  options: { status?: string; limit?: number } = {},
): Promise<Reminder[]> {
  const { status = "pending", limit = 20 } = options;
  let query = getSupabase()
    .from("reminders").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(limit);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export async function completeReminder(userId: string, id?: string, title?: string): Promise<boolean> {
  let query = getSupabase().from("reminders").update({ status: "done", completed_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "pending");
  if (id) query = query.eq("id", id);
  else if (title) query = query.eq("title", title);
  else return false;
  const { error } = await query;
  return !error;
}

export async function completeAllPendingReminders(userId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("reminders").update({ status: "done", completed_at: new Date().toISOString() })
    .eq("user_id", userId).eq("status", "pending").select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function deleteReminder(userId: string, id: string): Promise<void> {
  const { error } = await getSupabase().from("reminders").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteAllPendingReminders(userId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("reminders").delete().eq("user_id", userId).eq("status", "pending").select("id");
  if (error) throw error;
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// IPC-facing helpers (resolve userId from the active session internally)
// ---------------------------------------------------------------------------

export async function listRemindersIpc(status = "pending"): Promise<ReminderItem[]> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("reminders")
    .select("id, title, due_at, status")
    .eq("user_id", userId)
    .eq("status", status)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    dueAt: r.due_at as string | null,
    status: r.status as string,
  }));
}

export async function completeReminderIpc(id: string): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { error } = await supabase
    .from("reminders")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteReminderIpc(id: string): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { error } = await supabase.from("reminders").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}
