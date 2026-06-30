import { getSupabase } from "../supabase";
import type { LinkType, MemoryLink, MemoryType } from "./types";
import { searchMemories } from "./search";

export interface LinkedMemory {
  id: string;
  content: string;
  category: string | null;
  memory_type: MemoryType | null;
  salience: number;
  link_type: LinkType;
  direction: "from" | "to";
  created_at: string;
}

// Extract a person's name from relationship-type memory content
function extractPersonName(content: string): string | null {
  const match = content.match(
    /\bmy (?:professor|prof|teacher|tutor|lecturer|supervisor|doctor|therapist|coach|mentor|boss|manager|colleague|coworker|classmate|roommate|friend|best friend|partner|boyfriend|girlfriend|husband|wife|brother|sister|mom|mum|dad|father|mother|aunt|uncle|grandma|grandpa|cousin)\s+(?:is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  );
  return match?.[1] ?? null;
}

// Detect if content corrects a prior fact
function isCorrection(content: string): boolean {
  return /\b(?:actually|not|no longer|changed|instead|but now|correction|update)\b/i.test(content);
}

// Check whether a link already exists in either direction
async function linkExists(
  supabase: ReturnType<typeof getSupabase>,
  fromId: string,
  toId: string,
  linkType: LinkType,
): Promise<boolean> {
  const { data } = await supabase
    .from("memory_links")
    .select("id")
    .or(
      `and(from_memory_id.eq.${fromId},to_memory_id.eq.${toId},link_type.eq.${linkType}),and(from_memory_id.eq.${toId},to_memory_id.eq.${fromId},link_type.eq.${linkType})`,
    )
    .maybeSingle();

  return Boolean(data);
}

export async function linkMemories(
  userId: string,
  fromId: string,
  toId: string,
  linkType: LinkType,
): Promise<void> {
  if (fromId === toId) return;
  const supabase = getSupabase();

  const exists = await linkExists(supabase, fromId, toId, linkType);
  if (exists) return;

  const { error } = await supabase.from("memory_links").insert({
    user_id: userId,
    from_memory_id: fromId,
    to_memory_id: toId,
    link_type: linkType,
  });

  if (error && !error.message.includes("unique")) {
    console.error("[memory] link creation failed:", error);
  }
}

export async function getLinkedMemories(
  memoryId: string,
  userId: string,
): Promise<LinkedMemory[]> {
  const supabase = getSupabase();

  const { data: links, error } = await supabase
    .from("memory_links")
    .select("id, from_memory_id, to_memory_id, link_type")
    .eq("user_id", userId)
    .or(`from_memory_id.eq.${memoryId},to_memory_id.eq.${memoryId}`);

  if (error || !links || links.length === 0) return [];

  const linkedIds = links.map((l) =>
    l.from_memory_id === memoryId ? l.to_memory_id : l.from_memory_id,
  );

  const { data: memories, error: memError } = await supabase
    .from("memories")
    .select("id, content, category, memory_type, salience, created_at")
    .in("id", linkedIds)
    .eq("is_archived", false);

  if (memError || !memories) return [];

  const memoryMap = new Map(memories.map((m) => [m.id, m]));

  return links
    .map((link) => {
      const direction = link.from_memory_id === memoryId ? "from" : "to";
      const linkedId =
        direction === "from" ? link.to_memory_id : link.from_memory_id;
      const memory = memoryMap.get(linkedId);
      if (!memory) return null;
      return {
        ...memory,
        link_type: link.link_type as LinkType,
        direction,
      } as LinkedMemory;
    })
    .filter((l): l is LinkedMemory => l !== null);
}

export async function deleteLink(
  linkId: string,
  userId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("memory_links")
    .delete()
    .eq("id", linkId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

// Auto-detect and create links after a new memory is saved.
// Runs fire-and-forget — never blocks the save path.
export async function detectAndLinkRelationships(
  userId: string,
  newMemoryId: string,
  newContent: string,
  newType: MemoryType,
): Promise<void> {
  try {
    if (newType === "relationship") {
      const personName = extractPersonName(newContent);
      if (personName) {
        const related = await searchMemories(userId, personName, 5);
        for (const candidate of related) {
          if (candidate.id === newMemoryId) continue;
          await linkMemories(userId, newMemoryId, candidate.id, "related");
        }
      }
    }

    if (newType === "episodic") {
      // Link to other episodic memories in the same context
      const contextMatches = await searchMemories(userId, newContent, 5);
      for (const candidate of contextMatches) {
        if (candidate.id === newMemoryId) continue;
        if (candidate.memory_type === "episodic") {
          await linkMemories(userId, newMemoryId, candidate.id, "context_of");
        }
      }
    }

    if (newType === "goal") {
      const relatedGoals = await searchMemories(userId, newContent, 5);
      for (const candidate of relatedGoals) {
        if (candidate.id === newMemoryId) continue;
        if (candidate.memory_type === "goal") {
          await linkMemories(userId, newMemoryId, candidate.id, "related");
        }
      }
    }

    if (isCorrection(newContent)) {
      const candidates = await searchMemories(userId, newContent, 5);
      for (const candidate of candidates) {
        if (candidate.id === newMemoryId) continue;
        await linkMemories(userId, newMemoryId, candidate.id, "contradicts");
        break; // only link the top contradiction candidate
      }
    }
  } catch (err) {
    console.error("[memory] detectAndLinkRelationships failed:", err);
  }
}

export type { MemoryLink };
