import { extractSubjectKey } from "@/lib/memory/reconcile";
import type { MemorySearchResult } from "@/lib/memory/search";

// Stable profile topics that should stay in context even when the current
// message does not mention them directly.
const CORE_SUBJECTS = new Set([
  "education",
  "residence",
  "origin",
  "name",
  "age",
  "workplace",
  "job_title",
  "partner",
  "diet",
  "timezone",
  "birthday",
  "routine",
  "sleep_schedule",
  "fitness_routine",
  "goals",
]);

export const CORE_PROFILE_PATTERNS = [
  "university",
  "college",
  "school",
  "studying",
  "student",
  "degree",
  "major",
  "bachelor",
  "commerce",
  "lives in",
  "live in",
  "from ",
  "name is",
  "called ",
  "works at",
  "work at",
  "years old",
  "timezone",
  "allergic",
  "vegetarian",
  "vegan",
  "partner",
  "spouse",
  "usually",
  "always",
  "routine",
  "goal",
  "trying to",
  "work out",
  "wake up",
  "prefer",
];

export function isCoreProfileMemory(content: string): boolean {
  const key = extractSubjectKey(content);
  return key !== null && CORE_SUBJECTS.has(key);
}

// Keep the newest memory per core subject (e.g. one education fact, one residence).
export function pickCoreProfileMemories(
  memories: MemorySearchResult[],
): MemorySearchResult[] {
  const bySubject = new Map<string, MemorySearchResult>();

  for (const memory of memories) {
    const key = extractSubjectKey(memory.content);
    if (!key || !CORE_SUBJECTS.has(key)) continue;

    const existing = bySubject.get(key);
    if (!existing || memory.created_at > existing.created_at) {
      bySubject.set(key, memory);
    }
  }

  return [...bySubject.values()];
}

export const MINIMAL_CORE_SUBJECTS = [
  "name",
  "education",
  "residence",
  "timezone",
  "routine",
  "fitness_routine",
] as const;

// Highest-priority identity facts for side threads and light turns.
export function pickMinimalCoreProfileMemories(
  memories: MemorySearchResult[],
  limit = 4,
): MemorySearchResult[] {
  const minimalSet = new Set<string>(MINIMAL_CORE_SUBJECTS);
  const bySubject = new Map<string, MemorySearchResult>();

  for (const memory of memories) {
    const key = extractSubjectKey(memory.content);
    if (!key || !minimalSet.has(key)) continue;

    const existing = bySubject.get(key);
    if (!existing || memory.created_at > existing.created_at) {
      bySubject.set(key, memory);
    }
  }

  return [...bySubject.values()].slice(0, limit);
}
