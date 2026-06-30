import { describe, it, expect } from "vitest";
import { pickReplacementCandidate } from "./reconcile";

const makeMemory = (id: string, content: string) => ({
  id,
  content,
  category: null as string | null,
  memory_type: null as import("./types").MemoryType | null,
  salience: 0.6,
  is_pinned: false,
  valid_from: null as string | null,
  created_at: "2024-01-01T00:00:00Z",
});

describe("pickReplacementCandidate", () => {
  it("returns duplicate when content matches exactly", () => {
    const candidates = [makeMemory("1", "I like coffee")];
    const result = pickReplacementCandidate(candidates, "I like coffee");
    expect(result?.reason).toBe("duplicate");
  });

  it("returns null when no match", () => {
    const candidates = [makeMemory("1", "I like coffee")];
    const result = pickReplacementCandidate(candidates, "I enjoy hiking");
    expect(result).toBeNull();
  });
});
