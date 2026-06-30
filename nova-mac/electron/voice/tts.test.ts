import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesize } from "./tts";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.DEEPGRAM_API_KEY = "dg-test";
  vi.restoreAllMocks();
});

function audioResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
}

describe("synthesize", () => {
  it("returns base64 MP3 from the OpenAI provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse()));
    const out = await synthesize({ text: "hi", voice: "coral", speed: 1.1, hd: true, provider: "openai" });
    expect(Buffer.from(out.audioBase64, "base64")).toEqual(Buffer.from([1, 2, 3]));
  });

  it("rejects google until it is wired on the Mac", async () => {
    await expect(
      synthesize({ text: "hi", voice: "x", speed: 1, provider: "google" }),
    ).rejects.toThrow(/not yet wired/i);
  });
});
