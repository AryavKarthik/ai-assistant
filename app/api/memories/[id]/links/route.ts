import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import {
  getLinkedMemories,
  linkMemories,
} from "@/lib/memory/relationships";
import type { LinkType } from "@/lib/supabase/types";

const VALID_LINK_TYPES = new Set<LinkType>([
  "related", "contradicts", "refines", "context_of", "part_of",
]);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return await withAuth(async ({ user }) => {
      const links = await getLinkedMemories(id, user.id);
      return NextResponse.json({ links });
    });
  } catch (error) {
    console.error("GET /api/memories/[id]/links error:", error);
    return NextResponse.json({ error: "Failed to load links" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const toMemoryId = typeof body.to_memory_id === "string" ? body.to_memory_id.trim() : "";
    const linkType = typeof body.link_type === "string" ? body.link_type : "";

    if (!toMemoryId) {
      return NextResponse.json({ error: "to_memory_id is required" }, { status: 400 });
    }
    if (!VALID_LINK_TYPES.has(linkType as LinkType)) {
      return NextResponse.json({ error: "Invalid link_type" }, { status: 400 });
    }

    return await withAuth(async ({ user }) => {
      await linkMemories(user.id, id, toMemoryId, linkType as LinkType);
      return NextResponse.json({ ok: true });
    });
  } catch (error) {
    console.error("POST /api/memories/[id]/links error:", error);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}
