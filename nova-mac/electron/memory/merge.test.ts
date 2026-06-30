import { describe, it, expect } from "vitest";
import { mergeMemoryContent } from "./merge";

describe("mergeMemoryContent", () => {
  it("returns existing when new content is identical", () => {
    expect(mergeMemoryContent("I like coffee", "I like coffee")).toBe("I like coffee");
  });

  it("returns new content when existing is a subset", () => {
    const result = mergeMemoryContent("I like coffee", "I like coffee and tea");
    expect(result).toContain("tea");
  });

  it("returns new content when it is a full replacement", () => {
    const result = mergeMemoryContent("I work at Google", "I work at Apple Inc company");
    expect(result).toContain("Apple");
  });
});
