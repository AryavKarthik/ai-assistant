import { createServerClient } from "@/lib/supabase/server";
import { resolveUserTimezone } from "@/lib/chat/runtime-context";
import {
  DEFAULT_USER_PREFERENCES,
  type ProactiveTier,
  type UserPreferences,
} from "@/lib/proactive/types";

function normalizeTime(value: string): string {
  if (value.length === 5) return `${value}:00`;
  return value;
}

function rowToPreferences(row: Record<string, unknown>): UserPreferences {
  return {
    user_id: String(row.user_id),
    proactive_tier: row.proactive_tier as ProactiveTier,
    brief_enabled: Boolean(row.brief_enabled),
    brief_time_local: normalizeTime(String(row.brief_time_local ?? "07:00:00")),
    timezone: String(row.timezone ?? "UTC"),
    quiet_hours_start: normalizeTime(
      String(row.quiet_hours_start ?? "22:00:00"),
    ),
    quiet_hours_end: normalizeTime(String(row.quiet_hours_end ?? "08:00:00")),
    push_proactive_enabled: Boolean(row.push_proactive_enabled),
    last_brief_local_date: row.last_brief_local_date
      ? String(row.last_brief_local_date)
      : null,
    updated_at: String(row.updated_at),
  };
}

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const timezone = await resolveUserTimezone(userId);
    return {
      user_id: userId,
      ...DEFAULT_USER_PREFERENCES,
      timezone,
      updated_at: new Date().toISOString(),
    };
  }
  return rowToPreferences(data);
}

export type UserPreferencesPatch = Partial<
  Omit<UserPreferences, "user_id" | "updated_at" | "last_brief_local_date">
>;

export async function upsertUserPreferences(
  userId: string,
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  const supabase = createServerClient();
  const existing = await getUserPreferences(userId);

  const merged = {
    user_id: userId,
    proactive_tier: patch.proactive_tier ?? existing.proactive_tier,
    brief_enabled: patch.brief_enabled ?? existing.brief_enabled,
    brief_time_local: patch.brief_time_local ?? existing.brief_time_local,
    timezone: patch.timezone ?? existing.timezone,
    quiet_hours_start: patch.quiet_hours_start ?? existing.quiet_hours_start,
    quiet_hours_end: patch.quiet_hours_end ?? existing.quiet_hours_end,
    push_proactive_enabled:
      patch.push_proactive_enabled ?? existing.push_proactive_enabled,
    last_brief_local_date: existing.last_brief_local_date,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(merged, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) throw error;
  return rowToPreferences(data);
}

export async function markBriefSentForDate(
  userId: string,
  localDate: string,
): Promise<void> {
  const supabase = createServerClient();
  const existing = await getUserPreferences(userId);

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: userId,
      proactive_tier: existing.proactive_tier,
      brief_enabled: existing.brief_enabled,
      brief_time_local: existing.brief_time_local,
      timezone: existing.timezone,
      quiet_hours_start: existing.quiet_hours_start,
      quiet_hours_end: existing.quiet_hours_end,
      push_proactive_enabled: existing.push_proactive_enabled,
      last_brief_local_date: localDate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

export async function listProactiveUserPreferences(): Promise<UserPreferences[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .neq("proactive_tier", "off");

  if (error) throw error;
  return (data ?? []).map(rowToPreferences);
}

export async function listBriefEnabledUsers(): Promise<UserPreferences[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("brief_enabled", true)
    .eq("proactive_tier", "full");

  if (error) throw error;
  return (data ?? []).map(rowToPreferences);
}
