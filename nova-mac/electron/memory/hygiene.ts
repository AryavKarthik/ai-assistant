// Memory hygiene for a single user: dedupe + embedding backfill. Run once a
// day from the proactive scheduler (see hygiene-store.ts's gate) — nova-mac
// has no cron infra, and while the shared web app's weekly cron already
// covers this for the same Supabase table, a user who only ever runs Nova
// shouldn't be left with no automatic cleanup at all.
import { getSupabase } from "../supabase";
import { dedupeUserMemories } from "./save";
import { embedText } from "./embed";

async function backfillMissingEmbeddings(userId: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("memories")
    .select("id, content")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .is("embedding", null)
    .limit(200);

  if (error) throw error;

  let count = 0;
  for (const memory of data ?? []) {
    try {
      const embedding = await embedText(memory.content as string);
      if (embedding.length === 0) continue;
      const { error: updateError } = await supabase
        .from("memories")
        .update({ embedding })
        .eq("id", memory.id as string);
      if (!updateError) count++;
    } catch (err) {
      console.error(`[memory-hygiene] embedding backfill failed for ${memory.id}:`, err);
    }
  }

  return count;
}

export async function runMemoryHygiene(userId: string): Promise<{ deduped: number; embeddingsBackfilled: number }> {
  const embeddingsBackfilled = await backfillMissingEmbeddings(userId);
  const deduped = await dedupeUserMemories(userId);
  return { deduped, embeddingsBackfilled };
}
