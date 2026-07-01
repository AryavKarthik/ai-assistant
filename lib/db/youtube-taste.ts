import { createServerClient } from "@/lib/supabase/server";

export interface YoutubeTasteProfile {
  topChannels: string[];
  likedTopics: string[];
  playlistCount: number;
  summary: string;
}

export async function getYoutubeTasteCache(
  userId: string,
): Promise<{ profile: YoutubeTasteProfile; refreshedAt: string } | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("youtube_taste_cache")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    profile: data.profile_json as YoutubeTasteProfile,
    refreshedAt: data.refreshed_at,
  };
}

export async function upsertYoutubeTasteCache(
  userId: string,
  profile: YoutubeTasteProfile,
): Promise<void> {
  const supabase = createServerClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("youtube_taste_cache").upsert(
    {
      user_id: userId,
      profile_json: profile,
      refreshed_at: now,
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

export async function deleteYoutubeTasteCache(userId: string): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("youtube_taste_cache")
    .delete()
    .eq("user_id", userId);

  if (error) throw error;
}
