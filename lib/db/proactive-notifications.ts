import { createServerClient } from "@/lib/supabase/server";
import type {
  ProactiveNotification,
  ProactiveNotificationStatus,
  ProactiveNotificationType,
} from "@/lib/proactive/types";

function rowToNotification(row: Record<string, unknown>): ProactiveNotification {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    type: row.type as ProactiveNotificationType,
    title: String(row.title),
    body: String(row.body),
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
    status: row.status as ProactiveNotificationStatus,
    snoozed_until: row.snoozed_until ? String(row.snoozed_until) : null,
    sent_at: row.sent_at ? String(row.sent_at) : null,
    created_at: String(row.created_at),
  };
}

export interface CreateProactiveNotificationInput {
  userId: string;
  type: ProactiveNotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export async function createProactiveNotification(
  input: CreateProactiveNotificationInput,
): Promise<ProactiveNotification> {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("proactive_notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
      status: "unread",
      sent_at: now,
    })
    .select("*")
    .single();

  if (error) throw error;
  return rowToNotification(data);
}

export async function listActiveNotifications(
  userId: string,
  limit = 50,
): Promise<ProactiveNotification[]> {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("proactive_notifications")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? [])
    .map(rowToNotification)
    .filter((n) => {
      if (n.status === "snoozed" && n.snoozed_until && n.snoozed_until > now) {
        return false;
      }
      return n.status === "unread" || n.status === "read" || n.status === "snoozed";
    });
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const notifications = await listActiveNotifications(userId, 100);
  return notifications.filter((n) => n.status === "unread").length;
}

export async function getProactiveNotification(
  userId: string,
  notificationId: string,
): Promise<ProactiveNotification | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("proactive_notifications")
    .select("*")
    .eq("id", notificationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToNotification(data) : null;
}

export async function updateNotificationStatus(
  userId: string,
  notificationId: string,
  status: ProactiveNotificationStatus,
  snoozedUntil?: string | null,
): Promise<ProactiveNotification> {
  const supabase = createServerClient();
  const updates: Record<string, unknown> = { status };
  if (snoozedUntil !== undefined) {
    updates.snoozed_until = snoozedUntil;
  }

  const { data, error } = await supabase
    .from("proactive_notifications")
    .update(updates)
    .eq("id", notificationId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return rowToNotification(data);
}

export async function countNudgesSentToday(
  userId: string,
  localDateStart: string,
): Promise<number> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("proactive_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("type", ["deadline_nudge", "overdue_nudge", "conflict_nudge"])
    .gte("created_at", localDateStart);

  if (error) throw error;
  return count ?? 0;
}

export async function hasRecentNotification(
  userId: string,
  type: ProactiveNotificationType,
  payloadKey: string,
  payloadValue: string,
  sinceIso: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("proactive_notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("created_at", sinceIso)
    .contains("payload", { [payloadKey]: payloadValue })
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function hasFollowUpForEvent(
  userId: string,
  eventId: string,
  localDate: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("proactive_notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "follow_up")
    .contains("payload", { calendar_event_id: eventId, local_date: localDate })
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
