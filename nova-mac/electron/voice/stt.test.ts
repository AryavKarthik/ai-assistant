import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribe } from "./stt";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  vi.restoreAllMocks();
});

describe("transcribe", () => {
  it("decodes base64 audio and returns the OpenAI transcript text", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ text: "  hello nova  " }), { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const out = await transcribe(
      { audioBase64: Buffer.from("fakeaudio").toString("base64"), mimeType: "audio/webm" },
      "openai",
    );
    expect(out).toBe("hello nova");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects google without GCP credentials configured", async () => {
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GCP_SERVICE_ACCOUNT_JSON;
    delete process.env.GCP_SERVICE_ACCOUNT_JSON_PATH;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    await expect(
      transcribe({ audioBase64: "", mimeType: "audio/webm" }, "google"),
    ).rejects.toThrow(/not configured/i);
  });
});
