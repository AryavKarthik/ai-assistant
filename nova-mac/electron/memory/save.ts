import { getSupabase } from "../supabase";
import type { Memory, MemoryCategory, MemorySourceType, MemoryType } from "./types";
import { mergeMemoryContent } from "./merge";
import { reconcileWithLLM } from "./llm-merge";
import { withUserMemoryLock } from "./lock";
import {
  findRelatedMemoryIds,
  pickReplacementCandidate,
  type ReplacementCandidate,
} from "./reconcile";
import { findReconciliationCandidates } from "./search";
import { embedText } from "./embed";
import { classifyMemory, TYPE_SALIENCE } from "./classify";

export type SaveMemoryAction = "created" | "replaced" | "unchanged" | "merged";

export interface SaveMemoryResult {
  memory: Memory;
  action: SaveMemoryAction;
  replacedContent?: string;
  removedDuplicateIds?: string[];
}

export interface SaveMemoryOptions {
  category?: MemoryCategory;
  memoryType?: MemoryType;
  sourceMessageId?: string;
  replacesMemoryId?: string;
  sourceType?: MemorySourceType;
  // When provided, skips classification (caller already knows the type)
  skipClassify?: boolean;
  confidence?: number;
  validFrom?: string;
}

const MEMORY_SELECT =
  "id, content, category, memory_type, salience, last_accessed_at, access_count, is_pinned, is_archived, source_type, valid_from, valid_until, confidence, metadata, source_message_id, created_at, user_id";

// Reasons that mean "definitely the same fact" — a plain string-pick merge is
// safe and an LLM call would just add latency for no benefit.
const UNAMBIGUOUS_REASONS = new Set<ReplacementCandidate["reason"]>([
  "subset",
]);
// Reasons that mean "probably the same fact, but a coarse regex/overlap/
// embedding heuristic could be wrong" — worth a cheap LLM adjudication so a
// false-positive match doesn't wrongly conflate two distinct facts, and so a
// true match gets a real consolidated merge instead of one string winning
// wholesale over the other.
const AMBIGUOUS_REASONS = new Set<ReplacementCandidate["reason"]>([
  "subject_key",
  "overlap",
  "semantic",
]);

function candidateToMemory(
  userId: string,
  candidate: {
    id: string;
    content: string;
    category: string | null;
    created_at: string;
  },
): Memory {
  return {
    id: candidate.id,
    user_id: userId,
    content: candidate.content,
    category: candidate.category,
    memory_type: null,
    salience: 0.6,
    last_accessed_at: null,
    access_count: 0,
    is_pinned: false,
    is_archived: false,
    source_type: null,
    valid_from: null,
    valid_until: null,
    confidence: 0.8,
    metadata: null,
    source_message_id: null,
    created_at: candidate.created_at,
  };
}

// Fire-and-forget embedding update — used only as a fallback when the inline
// embed call (in saveMemory/updateMemory below) fails; the normal path now
// embeds synchronously so new/updated rows are vector-searchable immediately.
function scheduleEmbedding(memoryId: string, content: string): void {
  embedText(content)
    .then((embedding) => {
      if (embedding.length === 0) return;
      return getSupabase()
        .from("memories")
        .update({ embedding })
        .eq("id", memoryId);
    })
    .catch((err: unknown) => {
      console.error("[memory] embedding failed, will retry on backfill:", err);
    });
}

// Given a match reason, decide the merged content: unambiguous reasons use the
// fast heuristic; ambiguous ones get an LLM adjudication first. Returns
// `sameFact: false` when the LLM concludes a heuristic match was a false
// positive (two genuinely different facts) — callers must fall through to an
// insert in that case rather than merging unrelated content together.
//
// `trustedMatch: true` is for the explicit replaces_memory_id path, where the
// caller (Claude, or a manual correction) already asserted these are the same
// fact — an LLM failure there safely falls back to the string heuristic.
// `trustedMatch: false` is for auto-matched candidates (subject_key/overlap/
// semantic) that a coarse heuristic *guessed* were the same fact; if the LLM
// adjudication call fails there, the safe default is `sameFact: false` — NOT
// a forced merge. This was a real bug found via live testing: Haiku wraps its
// "JSON only" reply in a ```json fence, JSON.parse threw, reconcileWithLLM
// returned null on effectively every call, and the old fallback here treated
// every null as "same fact, merge via mergeMemoryContent" — which silently
// discarded a genuinely distinct fact (a rock-climbing hobby memory got
// merged away into an unrelated favorite-fruit memory in testing) purely
// because the unrelated existing sentence happened to be textually longer.
// Duplicating a fact when the LLM is briefly unavailable is a nuisance a
// later dedupe pass fixes; silently deleting one is not recoverable.
async function resolveMerge(
  existingContent: string,
  incoming: string,
  reason: ReplacementCandidate["reason"],
  trustedMatch: boolean,
): Promise<{ sameFact: boolean; merged: string }> {
  if (UNAMBIGUOUS_REASONS.has(reason)) {
    return { sameFact: true, merged: mergeMemoryContent(existingContent, incoming) };
  }

  if (AMBIGUOUS_REASONS.has(reason)) {
    const adjudication = await reconcileWithLLM(existingContent, incoming);
    if (adjudication) {
      return adjudication.sameFact
        ? { sameFact: true, merged: adjudication.mergedContent }
        : { sameFact: false, merged: incoming };
    }
    if (!trustedMatch) {
      return { sameFact: false, merged: incoming };
    }
  }

  // Reached only for a trusted explicit replace (LLM unavailable/failed):
  // caller already established same-fact intent, so the heuristic merge is
  // safe here.
  return { sameFact: true, merged: mergeMemoryContent(existingContent, incoming) };
}

export async function updateMemory(
  userId: string,
  memoryId: string,
  content: string,
  category?: MemoryCategory,
  sourceMessageId?: string,
  memoryType?: MemoryType,
  embedding?: number[],
): Promise<Memory> {
  const supabase = getSupabase();
  const trimmedContent = content.trim();

  const { data, error } = await supabase
    .from("memories")
    .update({
      content: trimmedContent,
      category: category ?? null,
      memory_type: memoryType ?? null,
      source_message_id: sourceMessageId ?? null,
      ...(embedding && embedding.length > 0 ? { embedding } : {}),
    })
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select(MEMORY_SELECT)
    .single();

  if (error) throw error;

  if (!embedding || embedding.length === 0) {
    // No fresh embedding was supplied (or the inline embed call failed) —
    // re-embed in the background as before.
    scheduleEmbedding(memoryId, trimmedContent);
  }

  return data as Memory;
}

async function deleteMemories(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
  memoryIds: string[],
): Promise<void> {
  if (memoryIds.length === 0) return;

  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("user_id", userId)
    .in("id", memoryIds);

  if (error) throw error;
}

export async function saveMemory(
  userId: string,
  content: string,
  categoryOrOptions?: MemoryCategory | SaveMemoryOptions,
  sourceMessageId?: string,
  replacesMemoryId?: string,
): Promise<SaveMemoryResult> {
  // Normalise overloaded signature
  let category: MemoryCategory | undefined;
  let options: SaveMemoryOptions = {};

  if (typeof categoryOrOptions === "string") {
    category = categoryOrOptions;
    options = { category, sourceMessageId, replacesMemoryId };
  } else if (categoryOrOptions && typeof categoryOrOptions === "object") {
    options = categoryOrOptions;
    category = options.category;
  }

  const trimmed = content.trim();

  // Serialize writes per user: the regex auto-capture pipeline and Claude's
  // own save_memory tool call can both hit this function for the same turn,
  // and without this lock each one's duplicate-check query can run before the
  // other's insert/update has committed — the classic source of near-
  // duplicate rows with different wording.
  return withUserMemoryLock(userId, () =>
    saveMemoryLocked(userId, trimmed, category, options, sourceMessageId, replacesMemoryId),
  );
}

async function saveMemoryLocked(
  userId: string,
  trimmed: string,
  category: MemoryCategory | undefined,
  options: SaveMemoryOptions,
  sourceMessageId?: string,
  replacesMemoryId?: string,
): Promise<SaveMemoryResult> {
  const supabase = getSupabase();

  // Classify + embed in parallel — both are needed before we can reconcile or
  // write. Embedding is now synchronous (was fire-and-forget after insert),
  // closing the "new memory is vector-search-blind for a while" gap and
  // giving reconciliation a real semantic-similarity signal to work with.
  const classifyPromise =
    options.skipClassify || options.memoryType
      ? Promise.resolve({
          memory_type: options.memoryType ?? ("fact" as MemoryType),
          confidence: options.confidence ?? 0.8,
          valid_from: options.validFrom,
        })
      : classifyMemory(trimmed);

  const embedPromise = embedText(trimmed).catch((err: unknown) => {
    console.error("[memory] inline embedding failed, will retry on backfill:", err);
    return [] as number[];
  });

  if (options.replacesMemoryId ?? replacesMemoryId) {
    const targetId = (options.replacesMemoryId ?? replacesMemoryId)!;
    const { data: existing, error: fetchError } = await supabase
      .from("memories")
      .select(MEMORY_SELECT)
      .eq("id", targetId)
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) throw new Error("Memory to replace was not found");

    const [classification, embedding] = await Promise.all([classifyPromise, embedPromise]);
    // An explicit replaces_memory_id means the caller (Claude, or a manual
    // correction) already knows this is the same fact — always merge, never
    // reject as "different facts" the way the ambiguous auto-match path can.
    const { merged } = await resolveMerge(existing.content, trimmed, "subject_key", true);
    const memory = await updateMemory(
      userId,
      targetId,
      merged,
      category ?? (existing.category as MemoryCategory | undefined),
      options.sourceMessageId ?? sourceMessageId,
      classification.memory_type,
      embedding,
    );

    const candidates = await findReconciliationCandidates(userId, merged, embedding);
    const duplicateIds = findRelatedMemoryIds(candidates, merged, memory.id, category);
    await deleteMemories(supabase, userId, duplicateIds);

    return {
      memory,
      action: merged === existing.content ? "unchanged" : "merged",
      replacedContent: existing.content,
      removedDuplicateIds: duplicateIds,
    };
  }

  const [classification, embedding] = await Promise.all([classifyPromise, embedPromise]);
  const candidates = await findReconciliationCandidates(userId, trimmed, embedding);
  const replacement = pickReplacementCandidate(candidates, trimmed, category);

  if (replacement?.reason === "duplicate") {
    return {
      memory: candidateToMemory(userId, replacement),
      action: "unchanged",
    };
  }

  if (replacement) {
    const { sameFact, merged } = await resolveMerge(
      replacement.content,
      trimmed,
      replacement.reason,
      false,
    );

    if (sameFact) {
      const memory = await updateMemory(
        userId,
        replacement.id,
        merged,
        category ?? (replacement.category as MemoryCategory | undefined),
        options.sourceMessageId ?? sourceMessageId,
        classification.memory_type,
        embedding,
      );

      const duplicateIds = findRelatedMemoryIds(candidates, merged, memory.id, category);
      await deleteMemories(supabase, userId, duplicateIds);

      return {
        memory,
        action: merged === replacement.content ? "unchanged" : "merged",
        replacedContent: replacement.content,
        removedDuplicateIds: duplicateIds,
      };
    }
    // LLM concluded the heuristic match was a false positive (two genuinely
    // different facts) — fall through and insert `trimmed` as its own memory
    // instead of wrongly merging it into an unrelated existing row.
  }

  const salience = TYPE_SALIENCE[classification.memory_type] ?? 0.6;
  const sourceType = options.sourceType ?? "tool_save";

  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      content: trimmed,
      category: category ?? null,
      memory_type: classification.memory_type,
      salience,
      confidence: classification.confidence,
      source_type: sourceType,
      source_message_id: options.sourceMessageId ?? sourceMessageId ?? null,
      valid_from: classification.valid_from ?? null,
      ...(embedding.length > 0 ? { embedding } : {}),
    })
    .select(MEMORY_SELECT)
    .single();

  if (error) {
    // Migration 018 added a unique index on (user_id, normalized_content) for
    // non-archived rows — the last-resort DB-level backstop for a race the
    // in-process lock above can't cover (a different process — e.g. the web
    // app and nova-mac — inserting the same normalized content at the same
    // instant). Self-heal by updating the row that won the race instead of
    // failing the save outright.
    if ((error as { code?: string }).code === "23505") {
      const conflictCandidates = await findReconciliationCandidates(userId, trimmed, embedding);
      const conflictMatch = pickReplacementCandidate(conflictCandidates, trimmed, category);
      if (conflictMatch) {
        const merged = mergeMemoryContent(conflictMatch.content, trimmed);
        const memory = await updateMemory(
          userId,
          conflictMatch.id,
          merged,
          category ?? (conflictMatch.category as MemoryCategory | undefined),
          options.sourceMessageId ?? sourceMessageId,
          classification.memory_type,
          embedding,
        );
        return { memory, action: "merged", replacedContent: conflictMatch.content };
      }
    }
    throw error;
  }

  if (embedding.length === 0) {
    // Inline embed failed earlier — fall back to the old fire-and-forget retry.
    scheduleEmbedding(data.id, trimmed);
  }

  // Detect and link relationships — fire-and-forget
  import("./relationships")
    .then(({ detectAndLinkRelationships }) =>
      detectAndLinkRelationships(
        userId,
        data.id,
        trimmed,
        classification.memory_type,
      ),
    )
    .catch((err: unknown) =>
      console.error("[memory] relationship detection failed:", err),
    );

  return { memory: data as Memory, action: "created" };
}

// One-off cleanup for existing duplicate rows.
export async function dedupeUserMemories(userId: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("memories")
    .select("id, content, category, created_at")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const memories = data ?? [];
  const removedIds: string[] = [];
  // Use a minimal shape compatible with MemorySearchResult for dedup purposes
  const kept: Array<{ id: string; content: string; category: string | null; created_at: string; memory_type: null; salience: number; is_pinned: boolean; valid_from: null }> = [];

  for (const memory of memories) {
    let match: { candidate: (typeof kept)[number]; reason: ReplacementCandidate["reason"] } | null = null;
    for (const existing of kept) {
      const scored = pickReplacementCandidate(
        [existing],
        memory.content,
        memory.category as MemoryCategory | undefined,
      );
      if (scored) {
        match = { candidate: existing, reason: scored.reason };
        break;
      }
    }

    if (match) {
      const { sameFact, merged } = await resolveMerge(match.candidate.content, memory.content, match.reason, false);
      if (!sameFact) {
        kept.push({ ...memory, memory_type: null, salience: 0.6, is_pinned: false, valid_from: null });
        continue;
      }
      match.candidate.content = merged;
      await updateMemory(
        userId,
        match.candidate.id,
        merged,
        match.candidate.category as MemoryCategory | undefined,
      );
      removedIds.push(memory.id);
      continue;
    }

    kept.push({ ...memory, memory_type: null, salience: 0.6, is_pinned: false, valid_from: null });
  }

  await deleteMemories(supabase, userId, removedIds);
  return removedIds.length;
}
