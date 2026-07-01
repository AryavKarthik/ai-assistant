import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { setMemoryArchived } from "@/lib/db/memories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const archived = typeof body.archived === "boolean" ? body.archived : true;

    return await withAuth(async ({ user }) => {
      const memory = await setMemoryArchived(id, user.id, archived);
      if (!memory) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, is_archived: memory.is_archived });
    });
  } catch (error) {
    console.error("POST /api/memories/[id]/archive error:", error);
    return NextResponse.json({ error: "Failed to update archive status" }, { status: 500 });
  }
}
