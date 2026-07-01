import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { listMemories } from "@/lib/db/memories";
import { saveMemory } from "@/lib/memory/save";
import { searchMemories } from "@/lib/memory/search";
import type { MemoryCategory, MemoryType } from "@/lib/supabase/types";

const VALID_CATEGORIES = new Set<MemoryCategory>([
  "preference", "fact", "goal", "other",
]);

const VALID_MEMORY_TYPES = new Set<MemoryType>([
  "fact", "preference", "routine", "episodic", "goal", "relationship", "skill",
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);
    const categoryParam = searchParams.get("category");
    const memoryTypeParam = searchParams.get("memory_type");
    const includeArchived = searchParams.get("archived") === "true";

    const category =
      categoryParam && VALID_CATEGORIES.has(categoryParam as MemoryCategory)
        ? (categoryParam as MemoryCategory)
        : undefined;

    const memory_type =
      memoryTypeParam && VALID_MEMORY_TYPES.has(memoryTypeParam as MemoryType)
        ? (memoryTypeParam as MemoryType)
        : undefined;

    return await withAuth(async ({ user }) => {
      const memories = query
        ? await searchMemories(user.id, query, limit)
        : await listMemories(user.id, { limit, category, memory_type, includeArchived });

      const filtered = category
        ? memories.filter((m) => m.category === category)
        : memories;

      return NextResponse.json({
        memories: filtered.map((m) => ({
          id: m.id,
          content: m.content,
          category: m.category,
          memory_type: m.memory_type,
          salience: m.salience,
          is_pinned: m.is_pinned,
          is_archived: m.is_archived,
          confidence: m.confidence,
          valid_from: m.valid_from,
          created_at: m.created_at,
        })),
      });
    });
  } catch (error) {
    console.error("GET /api/memories error:", error);
    return NextResponse.json({ error: "Failed to load memories" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const categoryParam = typeof body.category === "string" ? body.category : undefined;
    const memoryTypeParam = typeof body.memory_type === "string" ? body.memory_type : undefined;
    const validFrom = typeof body.valid_from === "string" ? body.valid_from : undefined;

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
      const result = await saveMemory(user.id, content, {
        category,
        memoryType,
        validFrom,
        sourceType: "user_manual",
        confidence: 1.0,
        skipClassify: Boolean(memoryType),
      });

      return NextResponse.json({
        memory: {
          id: result.memory.id,
          content: result.memory.content,
          category: result.memory.category,
          memory_type: result.memory.memory_type,
          salience: result.memory.salience,
          is_pinned: result.memory.is_pinned,
          confidence: result.memory.confidence,
          valid_from: result.memory.valid_from,
          created_at: result.memory.created_at,
        },
        action: result.action,
      });
    });
  } catch (error) {
    console.error("POST /api/memories error:", error);
    const message = error instanceof Error ? error.message : "Failed to save memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
