import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./supabase";
import { getOrCreateConversation, resetConversationCache, loadLastNMessages } from "./conversation";


describe("getOrCreateConversation", () => {
  beforeEach(() => {
    resetConversationCache();
    vi.clearAllMocks();
  });

  it("returns existing conversation id when found", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conv-existing" }, error: null }),
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    const id = await getOrCreateConversation("user-1");
    expect(id).toBe("conv-existing");
  });

  it("creates a new conversation when none exists", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: { id: "conv-new" }, error: null }),
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    const id = await getOrCreateConversation("user-1");
    expect(id).toBe("conv-new");
  });

  it("uses cached id on subsequent calls without querying Supabase", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conv-cached" }, error: null }),
    });
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

    await getOrCreateConversation("user-1");
    await getOrCreateConversation("user-1");
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

describe("loadLastNMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns messages in chronological order (oldest first)", async () => {
    const rows = [
      { id: "m1", role: "user", content: "Hello" },
      { id: "m2", role: "assistant", content: "Hi there" },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    const msgs = await loadLastNMessages("conv-1", 10);
    expect(msgs[0].content).toBe("Hello");
    expect(msgs[1].content).toBe("Hi there");
  });
});
