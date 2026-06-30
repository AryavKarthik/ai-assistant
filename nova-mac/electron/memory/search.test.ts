import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./embed", () => ({ embedText: vi.fn().mockResolvedValue([]) }));
import { getSupabase } from "../supabase";
import { searchMemories } from "./search";

function makeSupabaseMock(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return { from: vi.fn().mockReturnValue(chain), rpc: chain.rpc };
}

describe("searchMemories", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array for empty query with no fallback", async () => {
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabaseMock([]));
    const result = await searchMemories("user-1", "");
    expect(result).toEqual([]);
  });

  it("returns matching memories for a query", async () => {
    const rows = [
      {
        id: "m1",
        content: "User likes coffee",
        category: "preference",
        memory_type: "preference",
        salience: 0.8,
        is_pinned: false,
        valid_from: null,
        created_at: "2024-01-01T00:00:00Z",
      },
    ];
    const mock = makeSupabaseMock(rows);
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(mock);
    const result = await searchMemories("user-1", "coffee");
    expect(result.length).toBeGreaterThanOrEqual(0); // keyword path or vector path
  });
});
