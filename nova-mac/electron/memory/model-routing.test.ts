import { describe, it, expect } from "vitest";
import { inferComplexity } from "./model-routing";

describe("inferComplexity", () => {
  it("returns light for simple queries", () => {
    expect(inferComplexity("what's the weather like?")).toBe("light");
  });

  it("returns heavy for step-by-step queries", () => {
    expect(inferComplexity("explain step-by-step how to build a trading bot")).toBe("heavy");
  });

  it("returns heavy for very long messages", () => {
    expect(inferComplexity("a".repeat(1300))).toBe("heavy");
  });

  it("returns light for empty string", () => {
    expect(inferComplexity("")).toBe("light");
  });
});
