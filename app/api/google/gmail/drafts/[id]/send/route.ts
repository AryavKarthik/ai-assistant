import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/auth/api";
import { isGmailPermissionError } from "@/lib/google/errors";
import { sendGmailDraft } from "@/lib/google/gmail";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  return withAuthRoute(async ({ user }) => {
    const { id: draftId } = await context.params;

    if (!draftId?.trim()) {
      return NextResponse.json({ error: "draft id is required" }, { status: 400 });
    }

    const result = await sendGmailDraft(user.id, draftId.trim());

    if ("error" in result) {
      const status = isGmailPermissionError(result.error) ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      threadId: result.threadId,
    });
  });
}
