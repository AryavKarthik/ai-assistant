import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import type { VoicePreferences } from "@shared/types";

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

export async function saveProactivePreferences(patch: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
}

export async function getAllPreferences(): Promise<{ voice: VoicePreferences; proactive: Record<string, unknown> }> {
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
    proactive: data ?? {},
  };
}
