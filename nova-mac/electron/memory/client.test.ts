import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "../supabase";
import { getUserId, resetUserIdCache } from "./client";

describe("getUserId", () => {
  beforeEach(() => {
    resetUserIdCache();
    vi.clearAllMocks();
  });

  it("returns userId when signed in", async () => {
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }) },
    });
    const id = await getUserId();
    expect(id).toBe("user-123");
  });

  it("caches the userId across calls", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({
      data: { user: { id: "user-123" } }, error: null,
    });
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ auth: { getUser: mockGetUser } });
    await getUserId();
    await getUserId();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it("throws when not signed in", async () => {
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    await expect(getUserId()).rejects.toThrow("Not signed in");
  });
});
