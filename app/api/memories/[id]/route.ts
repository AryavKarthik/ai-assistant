import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { deleteMemory, getMemoryForUser } from "@/lib/db/memories";
import { updateMemory } from "@/lib/memory/save";
import type { MemoryCategory, MemoryType } from "@/lib/supabase/types";

const VALID_CATEGORIES = new Set<MemoryCategory>([
  "preference", "fact", "goal", "other",
]);

const VALID_MEMORY_TYPES = new Set<MemoryType>([
  "fact", "preference", "routine", "episodic", "goal", "relationship", "skill",
]);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const categoryParam = typeof body.category === "string" ? body.category : undefined;
    const memoryTypeParam = typeof body.memory_type === "string" ? body.memory_type : undefined;

    const category =
      categoryParam && VALID_CATEGORIES.has(categoryParam as MemoryCategory)
        ? (categoryParam as MemoryCategory)
        : undefined;

    const memoryType =
      memoryTypeParam && VALID_MEMORY_TYPES.has(memoryTypeParam as MemoryType)
        ? (memoryTypeParam as MemoryType)
        : undefined;

    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    return await withAuth(async ({ user }) => {
      const existing = await getMemoryForUser(user.id, id);
      if (!existing) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }

      const memory = await updateMemory(
        user.id,
        id,
        content,
        category ?? (existing.category as MemoryCategory | undefined),
        undefined,
        memoryType ?? existing.memory_type ?? undefined,
      );

      return NextResponse.json({
        memory: {
          id: memory.id,
          content: memory.content,
          category: memory.category,
          memory_type: memory.memory_type,
          salience: memory.salience,
          is_pinned: memory.is_pinned,
          confidence: memory.confidence,
          valid_from: memory.valid_from,
          created_at: memory.created_at,
        },
      });
    });
  } catch (error) {
    console.error("PATCH /api/memories/[id] error:", error);
    return NextResponse.json({ error: "Failed to update memory" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return await withAuth(async ({ user }) => {
      const deleted = await deleteMemory(user.id, id);
      if (!deleted) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error("DELETE /api/memories/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }
}
