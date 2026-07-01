import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import {
  searchAllMemoryData,
  type MemoryDataType,
} from "@/lib/memory/manager-search";
import type { MemoryCategory, MemoryType } from "@/lib/supabase/types";

const VALID_TYPES = new Set<MemoryDataType>([
  "all", "facts", "workouts", "reminders",
]);

const VALID_CATEGORIES = new Set<MemoryCategory>([
  "preference", "fact", "goal", "other",
]);

const VALID_MEMORY_TYPES = new Set<MemoryType>([
  "fact", "preference", "routine", "episodic", "goal", "relationship", "skill",
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const typeParam = searchParams.get("type") ?? "all";
    const categoryParam = searchParams.get("category");
    const memoryTypeParam = searchParams.get("memory_type");
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);

    const type = VALID_TYPES.has(typeParam as MemoryDataType)
      ? (typeParam as MemoryDataType)
      : "all";
    const category =
      categoryParam && VALID_CATEGORIES.has(categoryParam as MemoryCategory)
        ? (categoryParam as MemoryCategory)
        : undefined;
    const memory_type =
      memoryTypeParam && VALID_MEMORY_TYPES.has(memoryTypeParam as MemoryType)
        ? (memoryTypeParam as MemoryType)
        : undefined;

    return await withAuth(async ({ user }) => {
      const result = await searchAllMemoryData(user.id, query, {
        limitPerType: limit,
        type,
        category,
        memory_type,
      });

      return NextResponse.json({
        query: result.query,
        facts: result.facts.map((fact) => ({
          id: fact.id,
          content: fact.content,
          category: fact.category,
          memory_type: fact.memory_type,
          salience: (fact as { salience?: number }).salience ?? 0.6,
          is_pinned: (fact as { is_pinned?: boolean }).is_pinned ?? false,
          is_archived: (fact as { is_archived?: boolean }).is_archived ?? false,
          confidence: (fact as { confidence?: number }).confidence ?? 0.8,
          valid_from: (fact as { valid_from?: string | null }).valid_from ?? null,
          created_at: fact.created_at,
        })),
        workouts: result.workouts.map((workout) => ({
          id: workout.id,
          exercise: workout.exercise,
          sets: workout.sets,
          reps: workout.reps,
          weight_kg: workout.weight_kg,
          duration_min: workout.duration_min,
          notes: workout.notes,
          logged_at: workout.logged_at,
        })),
        reminders: result.reminders.map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          due_at: reminder.due_at,
          status: reminder.status,
          created_at: reminder.created_at,
        })),
      });
    });
  } catch (error) {
    console.error("GET /api/memory/search error:", error);
    return NextResponse.json(
      { error: "Failed to search memory data" },
      { status: 500 },
    );
  }
}
