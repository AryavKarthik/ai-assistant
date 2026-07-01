import { createServerClient } from "@/lib/supabase/server";
import {
  listMemoriesForDecay,
  setMemoryArchived,
  updateMemorySalience,
} from "@/lib/db/memories";
import type { MemoryType } from "@/lib/supabase/types";

// How much salience decays per week for each type (0 = no decay)
const WEEKLY_DECAY: Partial<Record<MemoryType, number>> = {
  episodic: 0.04,
  goal: 0.02,
};

// Days before decay begins for each type
const DECAY_DELAY_DAYS: Partial<Record<MemoryType, number>> = {
  episodic: 14,
  goal: 30,
};

const ARCHIVE_THRESHOLD = 0.15;
const ARCHIVE_MAX_ACCESS = 2;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

interface DecayCycleResult {
  processed: number;
  decayed: number;
  archived: number;
}

function weeksOld(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / MS_PER_WEEK;
}

function daysSinceAccess(lastAccessedAt: string | null): number {
  if (!lastAccessedAt) return Infinity;
  return (Date.now() - new Date(lastAccessedAt).getTime()) / (24 * 60 * 60 * 1000);
}

export async function runDecayCycleForUser(
  userId: string,
): Promise<DecayCycleResult> {
  const result: DecayCycleResult = { processed: 0, decayed: 0, archived: 0 };
  const memories = await listMemoriesForDecay(userId);

  for (const memory of memories) {
    result.processed++;
    const type = memory.memory_type as MemoryType | null;
    if (!type || memory.is_pinned) continue;

    const decayRate = WEEKLY_DECAY[type];
    if (!decayRate) continue;

    const delayDays = DECAY_DELAY_DAYS[type] ?? 14;
    const ageWeeks = weeksOld(memory.created_at);
    if (ageWeeks * 7 < delayDays) continue;

    // For goal type: only decay if not recently accessed
    if (type === "goal") {
      const idleDays = daysSinceAccess(memory.last_accessed_at);
      if (idleDays < 30) continue;
    }

    const decayableWeeks = Math.max(0, ageWeeks - delayDays / 7);
    const totalDecay = decayRate * decayableWeeks;
    const newSalience = Math.max(0.1, memory.salience - totalDecay);

    if (newSalience < memory.salience - 0.01) {
      await updateMemorySalience(memory.id, newSalience);
      result.decayed++;

      // Archive if below threshold and rarely accessed
      if (
        newSalience < ARCHIVE_THRESHOLD &&
        memory.access_count <= ARCHIVE_MAX_ACCESS
      ) {
        await setMemoryArchived(memory.id, userId, true);
        result.archived++;
      }
    }
  }

  return result;
}

export async function runDecayCycleForAllUsers(): Promise<{
  users: number;
  total: DecayCycleResult;
}> {
  const supabase = createServerClient();
  const { data: users, error } = await supabase
    .from("users")
    .select("id");

  if (error) throw error;

  const total: DecayCycleResult = { processed: 0, decayed: 0, archived: 0 };
  let userCount = 0;

  for (const user of users ?? []) {
    try {
      const result = await runDecayCycleForUser(user.id);
      total.processed += result.processed;
      total.decayed += result.decayed;
      total.archived += result.archived;
      userCount++;
    } catch (err) {
      console.error(`[decay] failed for user ${user.id}:`, err);
    }
  }

  return { users: userCount, total };
}
