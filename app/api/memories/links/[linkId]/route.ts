import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { deleteLink } from "@/lib/memory/relationships";

interface RouteContext {
  params: Promise<{ linkId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { linkId } = await context.params;
    return await withAuth(async ({ user }) => {
      const deleted = await deleteLink(linkId, user.id);
      if (!deleted) {
        return NextResponse.json({ error: "Link not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    });
  } catch (error) {
    console.error("DELETE /api/memories/links/[linkId] error:", error);
    return NextResponse.json({ error: "Failed to delete link" }, { status: 500 });
  }
}
