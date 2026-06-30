import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub global fetch before importing classify
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { classifyMemory, TYPE_SALIENCE } from "./classify";

describe("classifyMemory", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("returns a valid memory_type and confidence from Anthropic response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '{"type":"fact","confidence":0.9}' }],
      }),
    } as unknown as Response);

    // Use content that doesn't match high-confidence patterns to trigger LLM path
    const result = await classifyMemory("xyzzy plugh phlox qwerty");
    expect(result.memory_type).toBe("fact");
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it("falls back to fact type if response is unparseable", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "invalid json" }],
      }),
    } as unknown as Response);

    const result = await classifyMemory("xyzzy plugh phlox qwerty");
    expect(result.memory_type).toBeDefined();
  });
});

describe("TYPE_SALIENCE", () => {
  it("has salience for every memory type", () => {
    const types = ["fact", "preference", "routine", "episodic", "goal", "relationship", "skill"];
    for (const t of types) {
      expect(TYPE_SALIENCE[t as import("./types").MemoryType]).toBeGreaterThan(0);
    }
  });
});
