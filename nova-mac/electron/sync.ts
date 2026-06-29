import { getSupabase } from "./supabase";
import type { ConversationSummary, MemorySummary } from "@shared/types";

export async function listConversations(limit = 50): Promise<ConversationSummary[]> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function listMemories(limit = 50): Promise<MemorySummary[]> {
  // NOTE: never select `embedding` — it is ~6KB of floats per row.
  const { data, error } = await getSupabase()
    .from("memories")
    .select("id, content, type, salience")
    .order("salience", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, content: r.content, type: r.type, salience: r.salience,
  }));
}
