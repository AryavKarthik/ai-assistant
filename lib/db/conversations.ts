import { createServerClient } from "@/lib/supabase/server";
import { MAIN_CHAT_TTL_MS } from "@/lib/chat/constants";
import type { Conversation } from "@/lib/supabase/types";

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
  isActive: boolean;
  section: "main" | "side";
}

const DEFAULT_TITLE = "New chat";
const TITLE_MAX_LENGTH = 50;

export function normalizeThreadSection(
  section: string | null | undefined,
): "main" | "side" {
  return section === "side" ? "side" : "main";
}

export function isMainConversation(conversation: {
  thread_section?: string | null;
}): boolean {
  return normalizeThreadSection(conversation.thread_section) === "main";
}

export function isMainChatExpired(
  conversation: Pick<Conversation, "created_at" | "thread_section">,
  now = Date.now(),
): boolean {
  if (!isMainConversation(conversation)) return false;
  const ageMs = now - new Date(conversation.created_at).getTime();
  return ageMs >= MAIN_CHAT_TTL_MS;
}

function normalizeConversationRow(row: Conversation): Conversation {
  return {
    ...row,
    thread_section: normalizeThreadSection(row.thread_section),
  };
}

export function deriveConversationTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_TITLE;
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

export async function getConversationById(
  conversationId: string,
): Promise<Conversation | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getConversationForUser(
  conversationId: string,
  userId: string,
): Promise<Conversation | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listConversations(
  userId: string,
): Promise<ConversationSummary[]> {
  await pruneExpiredMainConversations(userId);

  const supabase = createServerClient();
  let { data, error } = await supabase
    .from("conversations")
    .select("id, title, updated_at, is_active, thread_section")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error?.code === "PGRST204") {
    const fallback = await supabase
      .from("conversations")
      .select("id, title, updated_at, is_active")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    data = fallback.data as (typeof data) | null;
    error = fallback.error;
  }

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    isActive: row.is_active,
    section: row.thread_section === "side" ? "side" : "main",
  }));
}

export async function getMostRecentConversation(
  userId: string,
): Promise<Conversation | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function deactivateUserConversations(userId: string): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversations")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) throw error;
}

export async function setActiveConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getConversationForUser(conversationId, userId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await deactivateUserConversations(userId);

  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversations")
    .update({ is_active: true })
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function createConversation(
  userId: string,
  section: "main" | "side" = "main",
): Promise<Conversation> {
  await deactivateUserConversations(userId);

  const supabase = createServerClient();
  let { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, is_active: true, thread_section: section })
    .select("*")
    .single();

  if (error?.code === "PGRST204") {
    const fallback = await supabase
      .from("conversations")
      .insert({ user_id: userId, is_active: true })
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return { ...data, thread_section: data.thread_section ?? section };
}

export async function setConversationTitle(
  conversationId: string,
  title: string,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", conversationId)
    .is("title", null);

  if (error) throw error;
}

export async function deleteConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const conversation = await getConversationForUser(conversationId, userId);
  if (!conversation) return false;

  const supabase = createServerClient();

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId);

  if (messagesError) throw messagesError;

  const messageIds = (messages ?? []).map((message) => message.id);
  if (messageIds.length > 0) {
    const clearRefs = async (table: "memories" | "workouts" | "reminders") => {
      const { error } = await supabase
        .from(table)
        .update({ source_message_id: null })
        .eq("user_id", userId)
        .in("source_message_id", messageIds);
      if (error) throw error;
    };

    await clearRefs("memories");
    await clearRefs("workouts");
    await clearRefs("reminders");
  }

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) throw error;
  return true;
}

export async function pruneExpiredMainConversations(
  userId: string,
): Promise<number> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, created_at, thread_section")
    .eq("user_id", userId);

  if (error) throw error;

  let removed = 0;
  for (const row of data ?? []) {
    if (!isMainChatExpired(row)) continue;
    const deleted = await deleteConversation(userId, row.id);
    if (deleted) removed++;
  }
  return removed;
}

export async function getMostRecentMainConversation(
  userId: string,
): Promise<Conversation | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  for (const row of data ?? []) {
    const conversation = normalizeConversationRow(row);
    if (!isMainConversation(conversation)) continue;
    if (isMainChatExpired(conversation)) continue;
    return conversation;
  }

  return null;
}

export async function ensureFreshMainConversation(
  userId: string,
): Promise<Conversation> {
  await pruneExpiredMainConversations(userId);

  const existing = await getMostRecentMainConversation(userId);
  if (existing) {
    if (!existing.is_active) {
      await setActiveConversation(userId, existing.id);
      return { ...existing, is_active: true };
    }
    return existing;
  }

  return createConversation(userId, "main");
}

export async function resolveConversationForChat(
  userId: string,
  conversationId: string,
): Promise<{ conversation: Conversation; rotated: boolean }> {
  await pruneExpiredMainConversations(userId);

  const conversation = await getConversationForUser(conversationId, userId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (isMainChatExpired(conversation)) {
    await deleteConversation(userId, conversation.id);
    const fresh = await ensureFreshMainConversation(userId);
    return { conversation: fresh, rotated: true };
  }

  return { conversation, rotated: false };
}

export async function getOrCreateActiveConversation(
  userId: string,
): Promise<Conversation> {
  return ensureFreshMainConversation(userId);
}
