import { NextResponse } from "next/server";
import { authJson, withAuth } from "@/lib/auth/api";
import { CHAT_HISTORY_LIMIT } from "@/lib/chat/constants";
import { toClientMessage } from "@/lib/chat/message-metadata";
import {
  deleteConversation,
  getConversationForUser,
  isMainChatExpired,
  isMainConversation,
  resolveConversationForChat,
  setActiveConversation,
} from "@/lib/db/conversations";
import { loadLastNMessages } from "@/lib/db/messages";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return await withAuth(async ({ user }) => {
      let conversation = await getConversationForUser(id, user.id);

      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }

      let rotated = false;
      if (isMainConversation(conversation) && isMainChatExpired(conversation)) {
        const resolved = await resolveConversationForChat(user.id, conversation.id);
        conversation = resolved.conversation;
        rotated = resolved.rotated;
      } else {
        await setActiveConversation(user.id, conversation.id);
      }

      const messages = await loadLastNMessages(
        conversation.id,
        CHAT_HISTORY_LIMIT,
      );

      return NextResponse.json({
        conversationId: conversation.id,
        title: conversation.title ?? "New chat",
        rotated,
        messages: messages.map((msg) => toClientMessage(msg)),
      });
    });
  } catch (error) {
    console.error("GET /api/conversations/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to load conversation" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return authJson(async ({ user }) => {
      const deleted = await deleteConversation(user.id, id);
      if (!deleted) {
        throw new Error("Conversation not found");
      }
      return { success: true };
    });
  } catch (error) {
    console.error("DELETE /api/conversations/[id] error:", error);
    const message = error instanceof Error ? error.message : "Failed";
    const status = message === "Conversation not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
