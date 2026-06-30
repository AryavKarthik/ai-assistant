import { describe, it, expect } from "vitest";
import { SentenceBuffer } from "./sentence-buffer";

describe("SentenceBuffer", () => {
  it("emits a complete first sentence once enough text streams in", () => {
    const buf = new SentenceBuffer();
    const out: string[] = [];
    out.push(...buf.push("Hello there, this is Nova. "));
    expect(out.join(" ")).toContain("Hello there");
  });

  it("flush returns the trailing partial text", () => {
    const buf = new SentenceBuffer();
    buf.push("A short tail without a terminator");
    expect(buf.flush()).toContain("tail");
  });

  it("reset clears all buffered state", () => {
    const buf = new SentenceBuffer();
    buf.push("Some text. ");
    buf.reset();
    expect(buf.flush()).toBeNull();
  });
});
