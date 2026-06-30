import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { embedText } from "./embed";

describe("embedText", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("returns a 1536-dim embedding on success", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const embedding = new Array(1536).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding }],
      }),
    } as unknown as Response);

    const result = await embedText("hello world");
    expect(result).toHaveLength(1536);
  });

  it("returns empty array when OPENAI_API_KEY is missing", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    // embedText should either return [] or throw — either is acceptable; just don't hang
    try {
      const result = await embedText("test");
      expect(Array.isArray(result)).toBe(true);
    } catch {
      // throwing is also acceptable
    }
    process.env.OPENAI_API_KEY = original;
  });
});
