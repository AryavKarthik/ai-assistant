import { createServerClient } from "@/lib/supabase/server";
import type { Reminder, ReminderStatus } from "@/lib/supabase/types";

export interface ReminderInput {
  title: string;
  due_at?: string | null;
  source_message_id?: string;
}

export interface ListRemindersOptions {
  status?: ReminderStatus | "all";
  limit?: number;
}

export async function insertReminder(
  userId: string,
  input: ReminderInput,
): Promise<Reminder> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      user_id: userId,
      title: input.title,
      due_at: input.due_at ?? null,
      source_message_id: input.source_message_id ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listReminders(
  userId: string,
  options: ListRemindersOptions = {},
): Promise<Reminder[]> {
  const supabase = createServerClient();
  const { status = "pending", limit = 20 } = options;

  let query = supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listUpcomingReminders(
  userId: string,
  limit = 5,
): Promise<Reminder[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function listRemindersForTab(
  userId: string,
  limit = 50,
): Promise<Reminder[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export type ReminderDueLabel = "overdue" | "due_today" | "upcoming" | "no_due_date";

export function getReminderDueLabel(dueAt: string | null): ReminderDueLabel {
  if (!dueAt) return "no_due_date";

  const due = new Date(dueAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (due < startOfToday) return "overdue";
  if (due < endOfToday) return "due_today";
  return "upcoming";
}

export function formatReminderLine(reminder: {
  id: string;
  title: string;
  due_at: string | null;
}): string {
  const due = reminder.due_at ? ` due=${reminder.due_at}` : "";
  return `- [reminder id=${reminder.id}${due}] ${reminder.title}`;
}

export interface UpdateReminderInput {
  title?: string;
  due_at?: string | null;
  status?: ReminderStatus;
}

export async function listRemindersForMemory(
  userId: string,
  limit = 20,
): Promise<Reminder[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "done"])
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) throw error;
  return data ?? [];
}

export async function searchReminders(
  userId: string,
  query: string,
  options: { limit?: number } = {},
): Promise<Reminder[]> {
  const supabase = createServerClient();
  const trimmed = query.trim();
  const limit = Math.min(options.limit ?? 20, 50);

  if (!trimmed) {
    return listRemindersForMemory(userId, limit);
  }

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "done"])
    .ilike("title", `%${trimmed}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getReminderForUser(
  userId: string,
  reminderId: string,
): Promise<Reminder | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("id", reminderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function deleteReminder(
  userId: string,
  reminderId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reminders")
    .delete()
    .eq("id", reminderId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function updateReminderForMemory(
  userId: string,
  reminderId: string,
  input: UpdateReminderInput,
): Promise<Reminder> {
  const supabase = createServerClient();
  const updates: Record<string, string | null> = {};

  if (input.title !== undefined) {
    updates.title = input.title.trim();
  }
  if (input.due_at !== undefined) {
    updates.due_at = input.due_at;
  }
  if (input.status !== undefined) {
    updates.status = input.status;
  }

  const { data, error } = await supabase
    .from("reminders")
    .update(updates)
    .eq("id", reminderId)
    .eq("user_id", userId)
    .in("status", ["pending", "done"])
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateReminder(
  userId: string,
  reminderId: string,
  input: UpdateReminderInput,
): Promise<Reminder> {
  const supabase = createServerClient();
  const updates: Record<string, string | null> = {};

  if (input.title !== undefined) {
    updates.title = input.title.trim();
  }
  if (input.due_at !== undefined) {
    updates.due_at = input.due_at;
  }

  const { data, error } = await supabase
    .from("reminders")
    .update(updates)
    .eq("id", reminderId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function completeReminder(
  userId: string,
  reminderId: string,
): Promise<Reminder> {
  const supabase = createServerClient();

  const completedAt = new Date().toISOString();
  let { data, error } = await supabase
    .from("reminders")
    .update({
      status: "done",
      completed_at: completedAt,
    })
    .eq("id", reminderId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (
    error &&
    // 42703 = undefined_column (Postgres); PGRST204 is "no rows" — not a schema error
    ((error as { code?: string }).code === "42703" ||
      String((error as { message?: string }).message ?? "").includes("completed_at"))
  ) {
    // Migration 003 not applied — fall back to status-only update.
    ({ data, error } = await supabase
      .from("reminders")
      .update({ status: "done" })
      .eq("id", reminderId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle());
  }

  if (error) throw error;
  if (data) return data;

  const { data: existing, error: fetchError } = await supabase
    .from("reminders")
    .select("*")
    .eq("id", reminderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!existing) {
    throw new Error("Reminder not found");
  }
  if (existing.status === "done") {
    return existing;
  }

  throw new Error("Reminder could not be completed");
}

export async function completeAllPendingReminders(
  userId: string,
): Promise<number> {
  const pending = await listReminders(userId, { status: "pending", limit: 100 });
  let count = 0;
  for (const reminder of pending) {
    await completeReminder(userId, reminder.id);
    count++;
  }
  return count;
}

export async function deleteAllPendingReminders(
  userId: string,
): Promise<number> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reminders")
    .delete()
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

// Deletes completed reminders older than 24 hours.
export async function deleteStaleCompletedReminders(
  userId?: string,
): Promise<number> {
  const supabase = createServerClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("reminders")
    .delete()
    .eq("status", "done")
    .lt("completed_at", cutoff);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.select("id");
  if (
    error &&
    (error as { code?: string }).code === "42703" &&
    String((error as { message?: string }).message ?? "").includes(
      "completed_at",
    )
  ) {
    // Migration 003 not applied — skip cleanup until column exists.
    return 0;
  }
  if (error) throw error;
  return data?.length ?? 0;
}

export async function listDueUnnotifiedReminders(
  userId?: string,
): Promise<Reminder[]> {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  let query = supabase
    .from("reminders")
    .select("*")
    .eq("status", "pending")
    .is("notified_at", null)
    .not("due_at", "is", null)
    .lte("due_at", now)
    .order("due_at", { ascending: true });

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data ?? [];
}

export async function markReminderNotified(reminderId: string): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("reminders")
    .update({
      notified_at: new Date().toISOString(),
      notification_channel: "push",
    })
    .eq("id", reminderId)
    .eq("status", "pending");

  if (error) throw error;
}
