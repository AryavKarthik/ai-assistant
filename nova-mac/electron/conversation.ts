import { getSupabase } from "./supabase";

let cachedConversationId: string | null = null;

export async function getOrCreateConversation(userId: string): Promise<string> {
  if (cachedConversationId) return cachedConversationId;

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("title", "Nova (Mac)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    cachedConversationId = existing.id as string;
    return cachedConversationId;
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "Nova (Mac)" })
    .select("id")
    .single();

  if (error) throw error;
  cachedConversationId = created.id as string;
  return cachedConversationId;
}

export function resetConversationCache(): void {
  cachedConversationId = null;
}

export async function persistUserMessage(
  conversationId: string,
  content: string,
): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content })
    .select("id")
    .single();

  if (error) throw error;

  // Bumping the conversation's updated_at is bookkeeping — don't hold the
  // voice turn hostage to a second Supabase round-trip.
  void supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .then(({ error: e }) => {
      if (e) console.error("[conversation] touch updated_at:", e);
    });

  return { id: data.id as string };
}

export async function persistAssistantMessage(
  conversationId: string,
  content: string,
): Promise<void> {
  if (!content.trim()) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "assistant", content });
  if (error) console.error("[conversation] persist assistant msg:", error);
}

export async function loadLastNMessages(
  conversationId: string,
  limit: number,
): Promise<Array<{ id: string; role: "user" | "assistant"; content: string }>> {
  const { data, error } = await getSupabase()
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; role: string; content: string }>)
    .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content }))
    .reverse();
}
