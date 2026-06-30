import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./classify", () => ({
  classifyMemory: vi.fn().mockResolvedValue({ memory_type: "fact", confidence: 0.9 }),
  TYPE_SALIENCE: { fact: 0.7, preference: 0.8, routine: 0.75, episodic: 0.5, goal: 0.85, relationship: 0.8, skill: 0.75 },
}));
vi.mock("./embed", () => ({ embedText: vi.fn().mockResolvedValue([]) }));
vi.mock("./search", () => ({
  findReconciliationCandidates: vi.fn().mockResolvedValue([]),
  searchMemories: vi.fn().mockResolvedValue([]),
}));
vi.mock("./reconcile", () => ({
  pickReplacementCandidate: vi.fn().mockReturnValue(null),
  findRelatedMemoryIds: vi.fn().mockReturnValue([]),
}));

import { getSupabase } from "../supabase";
import { saveMemory } from "./save";

function makeInsertMock(returnedData: unknown) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: returnedData, error: null }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe("saveMemory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a new memory and returns 'created' action", async () => {
    const newMemory = {
      id: "m1", user_id: "u1", content: "I like coffee", category: null,
      memory_type: "fact", salience: 0.7, last_accessed_at: null, access_count: 0,
      is_pinned: false, is_archived: false, source_type: "tool_save",
      valid_from: null, valid_until: null, confidence: 0.9, metadata: null,
      source_message_id: null, created_at: "2024-01-01T00:00:00Z",
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeInsertMock(newMemory));

    const result = await saveMemory("u1", "I like coffee");
    expect(result.action).toBe("created");
    expect(result.memory.content).toBe("I like coffee");
  });
});
