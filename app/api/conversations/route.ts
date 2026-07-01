import { authJson } from "@/lib/auth/api";
import {
  createConversation,
  listConversations,
} from "@/lib/db/conversations";

export async function GET() {
  return authJson(async ({ user }) => {
    const conversations = await listConversations(user.id);

    return {
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title ?? "New chat",
        updatedAt: conversation.updatedAt,
        isActive: conversation.isActive,
        section: conversation.section,
      })),
    };
  });
}

export async function POST(request: Request) {
  return authJson(async ({ user }) => {
    let section: "main" | "side" = "main";
    try {
      const body = await request.json();
      if (body?.section === "side") {
        section = "side";
      }
    } catch {
      // default to main if body is empty
    }
    const conversation = await createConversation(user.id, section);
    return {
      conversationId: conversation.id,
      section: conversation.thread_section === "side" ? "side" : "main",
    };
  });
}
