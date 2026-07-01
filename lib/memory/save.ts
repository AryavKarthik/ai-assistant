import { createServerClient } from "@/lib/supabase/server";
import type { Memory, MemoryCategory, MemorySourceType, MemoryType } from "@/lib/supabase/types";
import { mergeMemoryContent } from "@/lib/memory/merge";
import {
  findRelatedMemoryIds,
  pickReplacementCandidate,
} from "@/lib/memory/reconcile";
import {
  findReconciliationCandidates,
  type MemorySearchResult,
} from "@/lib/memory/search";
import { embedText } from "@/lib/memory/embed";
import { classifyMemory, TYPE_SALIENCE } from "@/lib/memory/classify";
import { updateMemoryEmbedding } from "@/lib/db/memories";

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

// Fire-and-forget embedding update — save is never blocked on embedding.
function scheduleEmbedding(memoryId: string, content: string): void {
  embedText(content)
    .then((embedding) => {
      if (embedding.length > 0) {
        return updateMemoryEmbedding(memoryId, embedding);
      }
    })
    .catch((err) => {
      console.error("[memory] embedding failed, will retry on backfill:", err);
    });
}

export async function updateMemory(
  userId: string,
  memoryId: string,
  content: string,
  category?: MemoryCategory,
  sourceMessageId?: string,
  memoryType?: MemoryType,
): Promise<Memory> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("memories")
    .update({
      content: content.trim(),
      category: category ?? null,
      memory_type: memoryType ?? null,
      source_message_id: sourceMessageId ?? null,
    })
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select(MEMORY_SELECT)
    .single();

  if (error) throw error;

  // Re-embed on content change
  scheduleEmbedding(memoryId, content.trim());

  return data as Memory;
}

async function deleteMemories(
  supabase: ReturnType<typeof createServerClient>,
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
  const supabase = createServerClient();

  // Classify + dedup in parallel where possible
  const classifyPromise =
    options.skipClassify || options.memoryType
      ? Promise.resolve({
          memory_type: options.memoryType ?? "fact" as MemoryType,
          confidence: options.confidence ?? 0.8,
          valid_from: options.validFrom,
        })
      : classifyMemory(trimmed);

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

    const [classification] = await Promise.all([classifyPromise]);
    const merged = mergeMemoryContent(existing.content, trimmed);
    const memory = await updateMemory(
      userId,
      targetId,
      merged,
      category ?? (existing.category as MemoryCategory | undefined),
      options.sourceMessageId ?? sourceMessageId,
      classification.memory_type,
    );

    const candidates = await findReconciliationCandidates(userId, merged);
    const duplicateIds = findRelatedMemoryIds(
      candidates,
      merged,
      memory.id,
      category,
    );
    await deleteMemories(supabase, userId, duplicateIds);

    return {
      memory,
      action: merged === existing.content ? "unchanged" : "merged",
      replacedContent: existing.content,
      removedDuplicateIds: duplicateIds,
    };
  }

  const [candidates, classification] = await Promise.all([
    findReconciliationCandidates(userId, trimmed),
    classifyPromise,
  ]);

  const replacement = pickReplacementCandidate(candidates, trimmed, category);

  if (replacement?.reason === "duplicate") {
    return {
      memory: candidateToMemory(userId, replacement),
      action: "unchanged",
    };
  }

  if (
    replacement &&
    (replacement.reason === "subject_key" || replacement.reason === "subset")
  ) {
    const merged = mergeMemoryContent(replacement.content, trimmed);
    const memory = await updateMemory(
      userId,
      replacement.id,
      merged,
      category ?? (replacement.category as MemoryCategory | undefined),
      options.sourceMessageId ?? sourceMessageId,
      classification.memory_type,
    );

    const duplicateIds = findRelatedMemoryIds(
      candidates,
      merged,
      memory.id,
      category,
    );
    await deleteMemories(supabase, userId, duplicateIds);

    return {
      memory,
      action: merged === replacement.content ? "unchanged" : "merged",
      replacedContent: replacement.content,
      removedDuplicateIds: duplicateIds,
    };
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
    })
    .select(MEMORY_SELECT)
    .single();

  if (error) throw error;

  // Embed after insert — fire-and-forget
  scheduleEmbedding(data.id, trimmed);

  // Detect and link relationships — fire-and-forget
  import("@/lib/memory/relationships")
    .then(({ detectAndLinkRelationships }) =>
      detectAndLinkRelationships(
        userId,
        data.id,
        trimmed,
        classification.memory_type,
      ),
    )
    .catch((err) =>
      console.error("[memory] relationship detection failed:", err),
    );

  return { memory: data as Memory, action: "created" };
}

// One-off cleanup for existing duplicate rows.
export async function dedupeUserMemories(userId: string): Promise<number> {
  const supabase = createServerClient();
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
    const duplicateOf = kept.find((existing) =>
      Boolean(
        pickReplacementCandidate(
          [existing],
          memory.content,
          memory.category as MemoryCategory | undefined,
        ),
      ),
    );

    if (duplicateOf) {
      const merged = mergeMemoryContent(duplicateOf.content, memory.content);
      duplicateOf.content = merged;
      await updateMemory(
        userId,
        duplicateOf.id,
        merged,
        duplicateOf.category as MemoryCategory | undefined,
      );
      removedIds.push(memory.id);
      continue;
    }

    kept.push({ ...memory, memory_type: null, salience: 0.6, is_pinned: false, valid_from: null });
  }

  await deleteMemories(supabase, userId, removedIds);
  return removedIds.length;
}
