import { createServerClient } from "@/lib/supabase/server";
import type {
  AssistantMessageMetadata,
} from "@/lib/chat/message-metadata";
import type { Message, MessageRole } from "@/lib/supabase/types";

const MESSAGE_COLUMNS =
  "id, conversation_id, role, content, created_at, metadata";

export async function loadLastNMessages(
  conversationId: string,
  limit = 40,
): Promise<Message[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).reverse();
}

export async function saveMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  metadata?: AssistantMessageMetadata | null,
): Promise<Message> {
  const supabase = createServerClient();

  const row: Record<string, unknown> = {
    conversation_id: conversationId,
    role,
    content,
  };

  if (metadata && role === "assistant") {
    row.metadata = metadata;
  }

  const { data, error } = await supabase
    .from("messages")
    .insert(row)
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw error;

  const { error: updateError } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (updateError) throw updateError;

  return data;
}

export async function getMessageForUser(
  messageId: string,
  userId: string,
): Promise<Message | null> {
  const supabase = createServerClient();

  const { data: message, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw error;
  if (!message) return null;

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("user_id")
    .eq("id", message.conversation_id)
    .maybeSingle();

  if (convError) throw convError;
  if (!conversation || conversation.user_id !== userId) return null;

  return message;
}

export async function updateMessageMetadata(
  messageId: string,
  userId: string,
  metadata: AssistantMessageMetadata,
): Promise<Message | null> {
  const existing = await getMessageForUser(messageId, userId);
  if (!existing || existing.role !== "assistant") return null;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("messages")
    .update({ metadata })
    .eq("id", messageId)
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}
