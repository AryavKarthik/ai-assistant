import { describe, it, expect, vi } from "vitest";

const rows = {
  conversations: [{ id: "c1", title: "Hi", updated_at: "2026-06-01T00:00:00Z" }],
  memories: [{ id: "m1", content: "User likes tea", type: "preference", salience: 0.8 }],
};

vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: (table: keyof typeof rows) => ({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: rows[table], error: null }),
        }),
      }),
    }),
  }),
}));

import { listConversations, listMemories } from "./sync";

describe("sync", () => {
  it("maps conversation rows to summaries", async () => {
    const out = await listConversations();
    expect(out).toEqual([{ id: "c1", title: "Hi", updatedAt: "2026-06-01T00:00:00Z" }]);
  });
  it("maps memory rows to summaries", async () => {
    const out = await listMemories();
    expect(out[0]).toEqual({ id: "m1", content: "User likes tea", type: "preference", salience: 0.8 });
  });
});
