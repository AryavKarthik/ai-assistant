import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/api";
import {
  parseEphemeralImage,
  persistedMessageText,
  type EphemeralImage,
} from "@/lib/chat/image";
import { buildAssistantMetadata } from "@/lib/chat/message-metadata";
import { runTurn, runTurnStream } from "@/lib/chat/run-turn";
import { createSseStream } from "@/lib/chat/stream-events";
import {
  deriveConversationTitle,
  ensureFreshMainConversation,
  resolveConversationForChat,
  setConversationTitle,
} from "@/lib/db/conversations";
import { saveMessage } from "@/lib/db/messages";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId : undefined;
    const modelPreference =
      typeof body.modelPreference === "string"
        ? body.modelPreference
        : body.modelPreference === null
          ? null
          : undefined;
    const inputModality =
      body.inputModality === "voice" ? ("voice" as const) : undefined;
    const clientTimeZone =
      typeof body.clientTimeZone === "string" && body.clientTimeZone.trim()
        ? body.clientTimeZone.trim()
        : undefined;
    const useStream =
      inputModality === "voice" && body.stream !== false;

    let ephemeralImage: EphemeralImage | undefined;
    if (body.image !== undefined) {
      const parsedImage = parseEphemeralImage(body.image);
      if ("error" in parsedImage) {
        return NextResponse.json({ error: parsedImage.error }, { status: 400 });
      }
      ephemeralImage = parsedImage.image;
    }

    if (!message && !ephemeralImage) {
      return NextResponse.json(
        { error: "message or image is required" },
        { status: 400 },
      );
    }

    if (useStream) {
      return await withAuth(async ({ user }) => {
        const userId = user.id;

        let conversation;
        let rotated = false;

        try {
          if (conversationId) {
            const resolved = await resolveConversationForChat(
              userId,
              conversationId,
            );
            conversation = resolved.conversation;
            rotated = resolved.rotated;
          } else {
            conversation = await ensureFreshMainConversation(userId);
          }
        } catch (err) {
          if (err instanceof Error && err.message === "Conversation not found") {
            return NextResponse.json(
              { error: "Conversation not found" },
              { status: 404 },
            );
          }
          throw err;
        }

        const storedMessage = persistedMessageText(
          message,
          Boolean(ephemeralImage),
        );
        const userMsg = await saveMessage(conversation.id, "user", storedMessage);

        if (!conversation.title) {
          await setConversationTitle(
            conversation.id,
            deriveConversationTitle(storedMessage),
          );
        }

        const stream = createSseStream(async (emit) => {
          emit({
            type: "meta",
            conversationId: conversation.id,
            rotated,
            userMessageId: userMsg.id,
          });

          const result = await runTurnStream(
            {
              userId,
              conversationId: conversation.id,
              userMessageId: userMsg.id,
              modelPreference,
              ephemeralImage,
              threadSection: conversation.thread_section,
              inputModality,
              clientTimeZone,
            },
            emit,
          );

          console.log(
            "[model-router] used model:",
            result.modelUsed,
            "preference:",
            result.modelPreference ?? "auto",
          );

          const assistantMsg = await saveMessage(
            conversation.id,
            "assistant",
            result.text,
            buildAssistantMetadata({
              ...result,
              inputModality,
            }),
          );

          emit({
            type: "done",
            assistantMessageId: assistantMsg.id,
            message: result.text,
            conversationId: conversation.id,
            rotated,
            modelUsed: result.modelUsed,
            modelPreference: result.modelPreference,
            actionReceipts: result.actionReceipts,
            trustTags: result.trustTags,
            highlightStored: result.highlightStored,
          });
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      });
    }

    return await withAuth(async ({ user }) => {
      const userId = user.id;

      let conversation;
      let rotated = false;

      try {
        if (conversationId) {
          const resolved = await resolveConversationForChat(userId, conversationId);
          conversation = resolved.conversation;
          rotated = resolved.rotated;
        } else {
          conversation = await ensureFreshMainConversation(userId);
        }
      } catch (err) {
        if (err instanceof Error && err.message === "Conversation not found") {
          return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 },
          );
        }
        throw err;
      }

      const storedMessage = persistedMessageText(
        message,
        Boolean(ephemeralImage),
      );
      const userMsg = await saveMessage(conversation.id, "user", storedMessage);

      if (!conversation.title) {
        await setConversationTitle(
          conversation.id,
          deriveConversationTitle(storedMessage),
        );
      }

      const result = await runTurn({
        userId,
        conversationId: conversation.id,
        userMessageId: userMsg.id,
        modelPreference,
        ephemeralImage,
        threadSection: conversation.thread_section,
        inputModality,
        clientTimeZone,
      });
      console.log(
        "[model-router] used model:",
        result.modelUsed,
        "preference:",
        result.modelPreference ?? "auto",
      );

      const assistantMsg = await saveMessage(
        conversation.id,
        "assistant",
        result.text,
        buildAssistantMetadata({
          ...result,
          inputModality,
        }),
      );

      return NextResponse.json({
        message: result.text,
        conversationId: conversation.id,
        assistantMessageId: assistantMsg.id,
        rotated,
        modelUsed: result.modelUsed,
        modelPreference: result.modelPreference,
        actionReceipts: result.actionReceipts,
        trustTags: result.trustTags,
        highlightStored: result.highlightStored,
      });
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/chat error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
