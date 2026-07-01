import { createServerClient } from "@/lib/supabase/server";
import type { ContextRetrievalPlan } from "@/lib/chat/thread-context";
import type { RuntimeClockContext } from "@/lib/chat/runtime-context";
import { getGoogleConnectionStatus } from "@/lib/db/google-tokens";
import { getUpcomingCalendarLines } from "@/lib/google/calendar";
import { getUnreadHighlights, isGmailInboxRecall } from "@/lib/google/gmail";
import {
  formatTastePreRetrieveLine,
  getCachedTasteProfile,
} from "@/lib/google/youtube";
import { formatReminderLine, listUpcomingReminders } from "@/lib/db/reminders";
import { getRecentWorkouts } from "@/lib/db/workouts";
import { updateMemoryAccess } from "@/lib/db/memories";
import type { Memory, MemoryType } from "@/lib/supabase/types";
import {
  expandSearchTerms,
  extractSearchTerms,
  extractSignificantTerms,
  formatWorkoutLine,
  isWorkoutRecallRelated,
  normalizeContent,
} from "@/lib/memory/keywords";
import { extractSubjectKey } from "@/lib/memory/reconcile";
import {
  CORE_PROFILE_PATTERNS,
  isCoreProfileMemory,
  pickCoreProfileMemories,
  pickMinimalCoreProfileMemories,
} from "@/lib/memory/profile";
import { embedText } from "@/lib/memory/embed";

export interface MemorySearchResult {
  id: string;
  content: string;
  category: string | null;
  memory_type: MemoryType | null;
  salience: number;
  is_pinned: boolean;
  is_archived?: boolean;
  confidence?: number;
  valid_from: string | null;
  created_at: string;
}

export interface SearchMemoriesOptions {
  fallbackToRecent?: boolean;
}

// Columns for search queries — no embedding (too large)
const SEARCH_COLS =
  "id, content, category, memory_type, salience, is_pinned, valid_from, created_at";

const EDUCATION_SEARCH_TERMS = [
  "school", "university", "college", "studying", "degree",
  "bachelor", "commerce", "major", "student",
];

function isYoutubeRecallRelated(message: string): boolean {
  return /youtube|video|watch|channel|playlist|creator/i.test(message);
}

function dedupeResults(results: MemorySearchResult[]): MemorySearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// Reciprocal rank fusion score — standard k=60
function rrfScore(rank: number): number {
  return 1 / (60 + rank);
}

// Salience multiplier: boosts high-salience memories in final ranking
function salienceBoost(salience: number): number {
  return 0.7 + 0.3 * salience;
}

// Type weight per intent (multiplier on final score)
const TYPE_WEIGHTS: Record<string, Partial<Record<MemoryType, number>>> = {
  profile_recall: { fact: 2.0, relationship: 2.0 },
  planning: { goal: 2.0, routine: 1.5 },
  scheduling: { routine: 2.0, episodic: 1.5 },
  workout: { routine: 2.0 },
};

function getTypeWeight(
  memoryType: MemoryType | null,
  intent: string,
): number {
  if (!memoryType) return 1.0;
  return TYPE_WEIGHTS[intent]?.[memoryType] ?? 1.0;
}

// Keyword-only search via ILIKE (existing pg_trgm path)
async function searchByKeywords(
  userId: string,
  terms: string[],
  limit: number,
): Promise<MemorySearchResult[]> {
  if (terms.length === 0 || limit <= 0) return [];
  const supabase = createServerClient();
  const orFilter = terms.map((t) => `content.ilike.%${t}%`).join(",");

  const { data, error } = await supabase
    .from("memories")
    .select(SEARCH_COLS)
    .eq("user_id", userId)
    .eq("is_archived", false)
    .or(orFilter)
    .order("salience", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as MemorySearchResult[];
}

// Vector similarity search via pgvector — skips rows without embeddings
async function searchByVector(
  userId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<MemorySearchResult[]> {
  if (queryEmbedding.length === 0 || limit <= 0) return [];
  const supabase = createServerClient();

  // Supabase JS doesn't have a direct vector operator — use rpc
  const { data, error } = await supabase.rpc("search_memories_by_vector", {
    p_user_id: userId,
    p_embedding: queryEmbedding,
    p_limit: limit,
  });

  if (error) {
    // RPC not yet available (pre-migration): degrade gracefully
    console.warn("[memory] vector search RPC unavailable, skipping:", error.message);
    return [];
  }

  return (data ?? []) as MemorySearchResult[];
}

// Hybrid search: merge keyword + vector results using Reciprocal Rank Fusion
async function hybridSearch(
  userId: string,
  query: string,
  limit: number,
  intent = "general",
): Promise<MemorySearchResult[]> {
  const terms = expandSearchTerms(extractSearchTerms(query));
  const keywordLimit = Math.ceil(limit * 1.5);
  const vectorLimit = Math.ceil(limit * 1.5);

  // Embed query (short query → skip vector to save latency)
  const queryEmbedding =
    query.trim().length >= 8 ? await embedText(query) : [];

  const [keywordResults, vectorResults] = await Promise.all([
    terms.length > 0 ? searchByKeywords(userId, terms, keywordLimit) : Promise.resolve([]),
    queryEmbedding.length > 0
      ? searchByVector(userId, queryEmbedding, vectorLimit)
      : Promise.resolve([]),
  ]);

  // Build RRF score map
  const scores = new Map<string, { score: number; result: MemorySearchResult }>();

  keywordResults.forEach((result, rank) => {
    const base = rrfScore(rank) * salienceBoost(result.salience) * getTypeWeight(result.memory_type, intent);
    scores.set(result.id, { score: base, result });
  });

  vectorResults.forEach((result, rank) => {
    const contribution = rrfScore(rank) * salienceBoost(result.salience) * getTypeWeight(result.memory_type, intent);
    const existing = scores.get(result.id);
    if (existing) {
      existing.score += contribution;
    } else {
      scores.set(result.id, { score: contribution, result });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.result);
}

function scoreMemoryRelevance(
  memory: MemorySearchResult,
  expandedTerms: string[],
  message: string,
  intent = "general",
): number {
  const normalized = normalizeContent(memory.content);
  const messageNorm = normalizeContent(message);
  let score = 0;

  for (const term of expandedTerms) {
    if (normalized.includes(term)) score += 2;
    if (messageNorm.includes(term) && normalized.includes(term)) score += 1;
  }

  if (isCoreProfileMemory(memory.content)) score += 4;
  if (memory.category === "fact") score += 1;
  if (memory.is_pinned) score += 6;

  const messageSubject = extractSubjectKey(message);
  const memorySubject = extractSubjectKey(memory.content);
  if (messageSubject && memorySubject && messageSubject === memorySubject) {
    score += 5;
  }

  // Apply type weight
  score *= getTypeWeight(memory.memory_type, intent);

  return score;
}

async function fetchCoreProfileMemories(
  userId: string,
): Promise<MemorySearchResult[]> {
  const supabase = createServerClient();
  const orFilter = CORE_PROFILE_PATTERNS.map(
    (p) => `content.ilike.%${p}%`,
  ).join(",");

  const { data, error } = await supabase
    .from("memories")
    .select(SEARCH_COLS)
    .eq("user_id", userId)
    .eq("is_archived", false)
    .or(orFilter)
    .order("salience", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw error;
  return pickCoreProfileMemories((data ?? []) as MemorySearchResult[]);
}

async function fetchMinimalCoreProfileMemories(
  userId: string,
): Promise<MemorySearchResult[]> {
  const supabase = createServerClient();
  const orFilter = CORE_PROFILE_PATTERNS.map(
    (p) => `content.ilike.%${p}%`,
  ).join(",");

  const { data, error } = await supabase
    .from("memories")
    .select(SEARCH_COLS)
    .eq("user_id", userId)
    .eq("is_archived", false)
    .or(orFilter)
    .order("salience", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return pickMinimalCoreProfileMemories((data ?? []) as MemorySearchResult[]);
}

// Always-include pinned memories (up to cap)
async function fetchPinnedMemories(
  userId: string,
  cap = 5,
): Promise<MemorySearchResult[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .select(SEARCH_COLS)
    .eq("user_id", userId)
    .eq("is_pinned", true)
    .eq("is_archived", false)
    .order("salience", { ascending: false })
    .limit(cap);

  if (error) return [];
  return (data ?? []) as MemorySearchResult[];
}

// Tiered retrieval driven by thread section + message intent plan.
export async function retrieveMemoriesForTurn(
  userId: string,
  userMessage: string,
  plan: ContextRetrievalPlan,
): Promise<MemorySearchResult[]> {
  if (plan.memoryLimit <= 0 && plan.coreProfileMode === "none") {
    return [];
  }

  const baseTerms = extractSearchTerms(userMessage);
  const expandedTerms = expandSearchTerms(baseTerms);

  const profilePromise =
    plan.coreProfileMode === "full"
      ? fetchCoreProfileMemories(userId)
      : plan.coreProfileMode === "minimal"
        ? fetchMinimalCoreProfileMemories(userId)
        : Promise.resolve([]);

  const [profileMemories, pinnedMemories, queryMatches, recentMemories] =
    await Promise.all([
      profilePromise,
      fetchPinnedMemories(userId, 5),
      hybridSearch(userId, userMessage, plan.queryMatchPool, plan.intent),
      plan.recentMemoryFallback > 0
        ? searchMemories(userId, "", plan.recentMemoryFallback, {
            fallbackToRecent: true,
          })
        : Promise.resolve([]),
    ]);

  const ranked = queryMatches
    .map((memory) => ({
      memory,
      score: scoreMemoryRelevance(memory, expandedTerms, userMessage, plan.intent),
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((e) => e.memory);

  const merged = dedupeResults([
    ...pinnedMemories,
    ...profileMemories,
    ...ranked,
  ]);

  const minFill = Math.min(
    plan.coreProfileMode === "none" ? 0 : 2,
    plan.memoryLimit,
  );

  if (merged.length < minFill && plan.recentMemoryFallback > 0) {
    for (const memory of recentMemories) {
      if (merged.some((item) => item.id === memory.id)) continue;
      merged.push(memory);
      if (merged.length >= plan.memoryLimit) break;
    }
  }

  const result = merged.slice(0, plan.memoryLimit);

  // Track access — fire-and-forget
  if (result.length > 0) {
    const ids = result.map((m) => m.id);
    updateMemoryAccess(ids).catch((err) =>
      console.error("[memory] access tracking failed:", err),
    );
  }

  return result;
}

// Public search used by Memory Manager and API — now uses hybrid search.
export async function searchMemories(
  userId: string,
  query: string,
  limit = 8,
  options: SearchMemoriesOptions = {},
): Promise<MemorySearchResult[]> {
  const supabase = createServerClient();
  const trimmed = query.trim();

  if (!trimmed) {
    if (!options.fallbackToRecent) return [];

    const { data, error } = await supabase
      .from("memories")
      .select(SEARCH_COLS)
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("salience", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as MemorySearchResult[];
  }

  return hybridSearch(userId, trimmed, limit);
}

// Broader search used before saving — catches duplicates the basic search misses.
export async function findReconciliationCandidates(
  userId: string,
  content: string,
): Promise<MemorySearchResult[]> {
  const batches = await Promise.all([
    searchMemories(userId, content, 25),
    searchMemories(userId, extractSignificantTerms(content, 8).join(" "), 25),
  ]);

  const subject = extractSubjectKey(content);
  if (subject === "education") {
    batches.push(
      await searchMemories(userId, EDUCATION_SEARCH_TERMS.join(" "), 40),
    );
  }

  return dedupeResults(batches.flat());
}

function buildContextHeader(plan: ContextRetrievalPlan): string {
  return `<relevant_context thread="${plan.threadSection}" intent="${plan.intent}" note="${plan.contextNote}">`;
}

export interface PreRetrieveOptions {
  forceGmail?: boolean;
}

// Format a memory for inclusion in the context block sent to Claude.
function formatMemoryLine(memory: MemorySearchResult): string {
  const type = memory.memory_type ?? memory.category ?? null;
  const typeLabel = type ? ` (${type})` : "";
  const dateLabel =
    memory.memory_type === "episodic" && memory.valid_from
      ? `, ${new Date(memory.valid_from).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
      : "";
  return `- [memory id=${memory.id}${typeLabel}${dateLabel}] ${memory.content}`;
}

// Pre-retrieve relevant context before every Claude call.
export async function preRetrieveContext(
  userId: string,
  userMessage: string,
  plan: ContextRetrievalPlan,
  clock?: RuntimeClockContext,
  options?: PreRetrieveOptions,
): Promise<string> {
  const lines: string[] = [];

  const [memories, reminders] = await Promise.all([
    retrieveMemoriesForTurn(userId, userMessage, plan),
    plan.reminderLimit > 0
      ? listUpcomingReminders(userId, plan.reminderLimit)
      : Promise.resolve([]),
  ]);

  for (const memory of memories) {
    lines.push(formatMemoryLine(memory));
  }

  for (const reminder of reminders) {
    lines.push(formatReminderLine(reminder));
  }

  const connections = await getGoogleConnectionStatus(userId);
  const asyncContextTasks: Array<Promise<void>> = [];

  if (connections.calendar.connected && plan.calendarLimit > 0) {
    asyncContextTasks.push(
      getUpcomingCalendarLines(userId, plan.calendarLimit, clock)
        .then((calendarLines) => { lines.push(...calendarLines); })
        .catch((err) => { console.error("[pre-retrieval] calendar fetch failed:", err); }),
    );
  }

  if (
    connections.gmail.connected &&
    plan.gmailHighlightLimit > 0 &&
    (options?.forceGmail || isGmailInboxRecall(userMessage))
  ) {
    asyncContextTasks.push(
      getUnreadHighlights(userId, plan.gmailHighlightLimit)
        .then((gmailLines) => { lines.push(...gmailLines); })
        .catch((err) => { console.error("[pre-retrieval] gmail fetch failed:", err); }),
    );
  }

  if (connections.youtube.connected && plan.youtubeTaste && isYoutubeRecallRelated(userMessage)) {
    asyncContextTasks.push(
      getCachedTasteProfile(userId)
        .then((taste) => { if (taste) lines.push(formatTastePreRetrieveLine(taste)); })
        .catch((err) => { console.error("[pre-retrieval] youtube taste failed:", err); }),
    );
  }

  if (plan.workoutLimit > 0 && isWorkoutRecallRelated(userMessage)) {
    asyncContextTasks.push(
      getRecentWorkouts(userId, plan.workoutLimit)
        .then((workouts) => { for (const w of workouts) lines.push(formatWorkoutLine(w)); })
        .catch((err) => { console.error("[pre-retrieval] workouts fetch failed:", err); }),
    );
  }

  if (asyncContextTasks.length > 0) {
    await Promise.all(asyncContextTasks);
  }

  if (lines.length === 0) return "";

  return `${buildContextHeader(plan)}\n${lines.join("\n")}\n</relevant_context>`;
}

export type { Memory };
