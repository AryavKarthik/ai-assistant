import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { toggleMemoryPin } from "@/lib/db/memories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const pinned = typeof body.pinned === "boolean" ? body.pinned : true;

    return await withAuth(async ({ user }) => {
      const memory = await toggleMemoryPin(id, user.id, pinned);
      if (!memory) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, is_pinned: memory.is_pinned });
    });
  } catch (error) {
    console.error("POST /api/memories/[id]/pin error:", error);
    return NextResponse.json({ error: "Failed to update pin" }, { status: 500 });
  }
}
