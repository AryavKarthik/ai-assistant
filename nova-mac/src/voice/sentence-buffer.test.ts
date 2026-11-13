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

describe("SentenceBuffer chunking for TTS", () => {
  function chunksOf(text: string): string[] {
    const buf = new SentenceBuffer();
    const out = buf.push(text);
    const tail = buf.flush();
    if (tail) out.push(tail);
    return out;
  }

  it("splits a whole reply pushed at once into sentences (resume path)", () => {
    const reply =
      "Yeah, you've got a few things on. First up is your stats lecture at ten. " +
      "Then the gym session you booked for one in the afternoon. " +
      "And dinner with Sam is at seven, so don't be late this time.";
    const out = chunksOf(reply);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.join(" ")).toBe(reply);
  });

  it("merges a too-short sentence with the next instead of stalling", () => {
    const out = chunksOf("Yeah. That one's at ten in the morning tomorrow. Then the gym at one o'clock after lunch.");
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[out.length - 1]!.length).toBeLessThan(80);
  });

  it("never emits a chunk longer than 160 chars, even without punctuation", () => {
    const runOn = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = chunksOf(runOn);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(160);
  });
});
