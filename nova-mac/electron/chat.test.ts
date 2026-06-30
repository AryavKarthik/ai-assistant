import { describe, it, expect } from "vitest";
import { buildAnthropicMessages } from "./chat";

describe("buildAnthropicMessages", () => {
  it("drops empty-content messages", () => {
    const out = buildAnthropicMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "   " },
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  it("coalesces consecutive same-role turns", () => {
    const out = buildAnthropicMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(out).toEqual([{ role: "user", content: "a\nb" }]);
  });
});
