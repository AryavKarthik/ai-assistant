import { getSupabase } from "../supabase";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

export async function getVoicePreferences(): Promise<VoicePreferences> {
  try {
    const { data } = await getSupabase()
      .from("user_preferences")
      .select("voice")
      .maybeSingle();
    const stored = (data?.voice ?? {}) as Partial<VoicePreferences>;
    return { ...DEFAULT_VOICE_PREFERENCES, ...stored };
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}
