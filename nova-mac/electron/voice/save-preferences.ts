import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import type { VoicePreferences, ProactivePrefs } from "@shared/types";
import { DEFAULT_PROACTIVE_PREFS } from "@shared/types";

function proactiveToRow(p: Partial<ProactivePrefs>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.proactiveMode !== undefined) row["proactive_mode"] = p.proactiveMode;
  if (p.dailyBriefEnabled !== undefined) row["daily_brief_enabled"] = p.dailyBriefEnabled;
  if (p.briefTimeLocal !== undefined) row["brief_time_local"] = p.briefTimeLocal;
  if (p.timezone !== undefined) row["timezone"] = p.timezone;
  if (p.quietHoursStart !== undefined) row["quiet_hours_start"] = p.quietHoursStart;
  if (p.quietHoursEnd !== undefined) row["quiet_hours_end"] = p.quietHoursEnd;
  return row;
}

function rowToProactive(row: Record<string, unknown> | null): ProactivePrefs {
  return {
    ...DEFAULT_PROACTIVE_PREFS,
    ...(row?.proactive_mode !== undefined ? { proactiveMode: row.proactive_mode as ProactivePrefs["proactiveMode"] } : {}),
    ...(row?.daily_brief_enabled !== undefined ? { dailyBriefEnabled: row.daily_brief_enabled as boolean } : {}),
    ...(row?.brief_time_local !== undefined ? { briefTimeLocal: row.brief_time_local as string } : {}),
    ...(row?.timezone !== undefined ? { timezone: row.timezone as string } : {}),
    ...(row?.quiet_hours_start !== undefined ? { quietHoursStart: row.quiet_hours_start as string } : {}),
    ...(row?.quiet_hours_end !== undefined ? { quietHoursEnd: row.quiet_hours_end as string } : {}),
  };
}

export async function saveVoicePreferences(patch: Partial<VoicePreferences>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data: existing } = await supabase
    .from("user_preferences")
    .select("voice")
    .eq("user_id", userId)
    .single();

  const merged = { ...(existing?.voice ?? {}), ...patch };

  await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, voice: merged }, { onConflict: "user_id" });
}

export async function saveProactivePreferences(patch: Partial<ProactivePrefs>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, ...proactiveToRow(patch) }, { onConflict: "user_id" });
}

export async function getAllPreferences(): Promise<{ voice: VoicePreferences; proactive: ProactivePrefs }> {
  const { getVoicePreferences } = await import("./preferences");
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data } = await supabase
    .from("user_preferences")
    .select("proactive_mode, daily_brief_enabled, brief_time_local, timezone, quiet_hours_start, quiet_hours_end")
    .eq("user_id", userId)
    .single();

  return {
    voice: await getVoicePreferences(),
    proactive: rowToProactive(data as Record<string, unknown> | null),
  };
}
