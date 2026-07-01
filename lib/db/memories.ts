import { createServerClient } from "@/lib/supabase/server";
import type { Memory, MemoryType } from "@/lib/supabase/types";

// Columns returned by all list/search queries — embedding excluded (1536 floats is expensive).
const MEMORY_COLUMNS =
  "id, content, category, memory_type, salience, last_accessed_at, access_count, is_pinned, is_archived, source_type, valid_from, valid_until, confidence, metadata, source_message_id, created_at, user_id";

export interface ListMemoriesOptions {
  limit?: number;
  category?: string;
  memory_type?: MemoryType;
  includeArchived?: boolean;
}

export async function listMemories(
  userId: string,
  options: ListMemoriesOptions = {},
): Promise<Memory[]> {
  const supabase = createServerClient();
  const { limit = 20, category, memory_type, includeArchived = false } = options;

  let query = supabase
    .from("memories")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId)
    .order("salience", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 50));

  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }
  if (category) {
    query = query.eq("category", category);
  }
  if (memory_type) {
    query = query.eq("memory_type", memory_type);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Memory[];
}

export async function listArchivedMemories(
  userId: string,
  limit = 20,
): Promise<Memory[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId)
    .eq("is_archived", true)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) throw error;
  return (data ?? []) as Memory[];
}

export async function getMemoryForUser(
  userId: string,
  memoryId: string,
): Promise<Memory | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .select(MEMORY_COLUMNS)
    .eq("id", memoryId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as Memory | null;
}

export async function deleteMemory(
  userId: string,
  memoryId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function updateMemoryEmbedding(
  memoryId: string,
  embedding: number[],
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("memories")
    .update({ embedding })
    .eq("id", memoryId);

  if (error) throw error;
}

// Batch-update last_accessed_at and access_count for retrieved memories.
export async function updateMemoryAccess(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = createServerClient();

  // Supabase JS doesn't support increment natively — use rpc or raw update with in()
  const { error } = await supabase.rpc("increment_memory_access", { memory_ids: ids });
  if (error) {
    // Fallback: best-effort timestamp-only update if RPC not available yet
    await supabase
      .from("memories")
      .update({ last_accessed_at: new Date().toISOString() })
      .in("id", ids);
  }
}

export async function toggleMemoryPin(
  memoryId: string,
  userId: string,
  pinned: boolean,
): Promise<Memory | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .update({ is_pinned: pinned })
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select(MEMORY_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data as Memory | null;
}

export async function setMemoryArchived(
  memoryId: string,
  userId: string,
  archived: boolean,
): Promise<Memory | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .update({ is_archived: archived })
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select(MEMORY_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data as Memory | null;
}

export async function listMemoriesByType(
  userId: string,
  memoryType: MemoryType,
  limit = 20,
): Promise<Memory[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId)
    .eq("memory_type", memoryType)
    .eq("is_archived", false)
    .order("salience", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) throw error;
  return (data ?? []) as Memory[];
}

// Fetch all non-archived memories for decay processing.
export async function listMemoriesForDecay(
  userId: string,
): Promise<Pick<Memory, "id" | "memory_type" | "salience" | "access_count" | "is_pinned" | "created_at" | "last_accessed_at">[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("memories")
    .select("id, memory_type, salience, access_count, is_pinned, created_at, last_accessed_at")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function updateMemorySalience(
  memoryId: string,
  salience: number,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("memories")
    .update({ salience: Math.max(0.1, Math.min(1.0, salience)) })
    .eq("id", memoryId);

  if (error) throw error;
}
