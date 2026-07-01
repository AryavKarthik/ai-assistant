import { listMemories } from "@/lib/db/memories";
import {
  listRemindersForMemory,
  searchReminders,
} from "@/lib/db/reminders";
import { listWorkouts, searchWorkouts } from "@/lib/db/workouts";
import { searchMemories, type MemorySearchResult } from "@/lib/memory/search";
import type { MemoryCategory, MemoryType, Reminder, Workout } from "@/lib/supabase/types";

export type MemoryDataType = "all" | "facts" | "workouts" | "reminders";

export interface SearchAllMemoryDataOptions {
  limitPerType?: number;
  type?: MemoryDataType;
  category?: MemoryCategory;
  memory_type?: MemoryType;
}

export interface SearchAllMemoryDataResult {
  query: string;
  facts: MemorySearchResult[];
  workouts: Workout[];
  reminders: Reminder[];
}

export async function searchAllMemoryData(
  userId: string,
  query: string,
  options: SearchAllMemoryDataOptions = {},
): Promise<SearchAllMemoryDataResult> {
  const trimmed = query.trim();
  const limitPerType = Math.min(options.limitPerType ?? 20, 50);
  const type = options.type ?? "all";

  const includeFacts = type === "all" || type === "facts";
  const includeWorkouts = type === "all" || type === "workouts";
  const includeReminders = type === "all" || type === "reminders";

  if (!trimmed) {
    const [facts, workouts, reminders] = await Promise.all([
      includeFacts
        ? listMemories(userId, {
            limit: limitPerType,
            category: options.category,
            memory_type: options.memory_type,
          }).then((rows) =>
            rows.map((row) => ({
              id: row.id,
              content: row.content,
              category: row.category,
              memory_type: row.memory_type,
              salience: row.salience,
              is_pinned: row.is_pinned,
              valid_from: row.valid_from,
              confidence: row.confidence,
              is_archived: row.is_archived,
              created_at: row.created_at,
            })),
          )
        : Promise.resolve([]),
      includeWorkouts ? listWorkouts(userId, { limit: limitPerType }) : Promise.resolve([]),
      includeReminders ? listRemindersForMemory(userId, limitPerType) : Promise.resolve([]),
    ]);

    return { query: "", facts: facts as MemorySearchResult[], workouts, reminders };
  }

  const [facts, workouts, reminders] = await Promise.all([
    includeFacts ? searchMemories(userId, trimmed, limitPerType) : Promise.resolve([]),
    includeWorkouts ? searchWorkouts(userId, { query: trimmed, limit: limitPerType }) : Promise.resolve([]),
    includeReminders ? searchReminders(userId, trimmed, { limit: limitPerType }) : Promise.resolve([]),
  ]);

  let filteredFacts = facts;
  if (options.category && includeFacts) {
    filteredFacts = filteredFacts.filter((f) => f.category === options.category);
  }
  if (options.memory_type && includeFacts) {
    filteredFacts = filteredFacts.filter((f) => f.memory_type === options.memory_type);
  }

  return { query: trimmed, facts: filteredFacts, workouts, reminders };
}
