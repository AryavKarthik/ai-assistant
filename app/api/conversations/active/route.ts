import { authJson } from "@/lib/auth/api";
import { CHAT_HISTORY_LIMIT } from "@/lib/chat/constants";
import { toClientMessage } from "@/lib/chat/message-metadata";
import { ensureFreshMainConversation } from "@/lib/db/conversations";
import { loadLastNMessages } from "@/lib/db/messages";

export async function GET() {
  return authJson(async ({ user }) => {
    const conversation = await ensureFreshMainConversation(user.id);
    const messages = await loadLastNMessages(
      conversation.id,
      CHAT_HISTORY_LIMIT,
    );

    return {
      conversationId: conversation.id,
      messages: messages.map((msg) => toClientMessage(msg)),
    };
  });
}
