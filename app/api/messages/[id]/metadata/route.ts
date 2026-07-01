import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/auth/api";
import {
  parseMessageMetadata,
  type AssistantMessageMetadata,
} from "@/lib/chat/message-metadata";
import type { ChatActionReceipt } from "@/lib/chat/types";
import { getMessageForUser, updateMessageMetadata } from "@/lib/db/messages";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isChatActionReceipt(value: unknown): value is ChatActionReceipt {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.action === "string" &&
    typeof record.outcome === "string" &&
    typeof record.source === "string" &&
    typeof record.status === "string"
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  return withAuthRoute(async ({ user }) => {
    const { id: messageId } = await context.params;

    if (!messageId?.trim()) {
      return NextResponse.json({ error: "message id is required" }, { status: 400 });
    }

    const message = await getMessageForUser(messageId, user.id);
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const body = await request.json();
    const current = parseMessageMetadata(message.metadata);
    const next: AssistantMessageMetadata = { ...current };

    if (Array.isArray(body.actionReceipts)) {
      const receipts = body.actionReceipts.filter(isChatActionReceipt);
      if (receipts.length !== body.actionReceipts.length) {
        return NextResponse.json(
          { error: "Invalid actionReceipts payload" },
          { status: 400 },
        );
      }
      next.actionReceipts = receipts;
    }

    if (Array.isArray(body.trustTags)) {
      next.trustTags = body.trustTags.filter(
        (tag: unknown): tag is string => typeof tag === "string",
      );
    }

    const updated = await updateMessageMetadata(messageId, user.id, next);
    if (!updated) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      actionReceipts: next.actionReceipts,
      trustTags: next.trustTags,
    });
  });
}
