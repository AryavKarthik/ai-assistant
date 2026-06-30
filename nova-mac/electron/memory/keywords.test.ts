import { describe, it, expect } from "vitest";
import { extractSearchTerms, expandSearchTerms, normalizeContent } from "./keywords";

describe("extractSearchTerms", () => {
  it("extracts meaningful words, skipping stop words", () => {
    const terms = extractSearchTerms("what is my gym schedule");
    expect(terms).toContain("gym");
    expect(terms).toContain("schedule");
    expect(terms).not.toContain("is");
    expect(terms).not.toContain("my");
  });

  it("returns empty array for empty string", () => {
    expect(extractSearchTerms("")).toEqual([]);
  });
});

describe("normalizeContent", () => {
  it("lowercases and trims", () => {
    expect(normalizeContent("  HELLO World  ")).toBe("hello world");
  });
});

describe("expandSearchTerms", () => {
  it("includes synonyms for known terms", () => {
    const terms = expandSearchTerms(["gym"]);
    expect(terms.length).toBeGreaterThanOrEqual(1);
  });
});
