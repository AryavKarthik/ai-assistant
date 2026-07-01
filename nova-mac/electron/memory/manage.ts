import { getSupabase } from "../supabase";
import { getUserId } from "./client";
import type { MemoryItem } from "@shared/types";

export async function searchMemoriesIpc(query: string): Promise<MemoryItem[]> {
  const supabase = getSupabase();
  const userId = await getUserId();

  let q = supabase
    .from("memories")
    .select("id, content, memory_type, salience, is_pinned, is_archived, created_at")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("salience", { ascending: false })
    .limit(50);

  if (query) {
    q = q.ilike("content", `%${query}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id as string,
    content: m.content as string,
    memoryType: m.memory_type as string | null,
    salience: m.salience as number,
    isPinned: (m.is_pinned as boolean | null) ?? false,
    isArchived: (m.is_archived as boolean | null) ?? false,
    createdAt: m.created_at as string,
  }));
}

export async function pinMemoryIpc(id: string, pinned: boolean): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { error } = await supabase
    .from("memories")
    .update({ is_pinned: pinned })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function archiveMemoryIpc(id: string, archived: boolean): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { error } = await supabase
    .from("memories")
    .update({ is_archived: archived })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteMemoryIpc(id: string): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}
