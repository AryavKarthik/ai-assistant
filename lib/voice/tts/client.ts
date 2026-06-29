import type { TtsProvider, TtsSynthesizeOptions } from "@/lib/voice/tts/types";

async function readStreamToBlob(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => undefined);
        throw new DOMException("Playback stopped", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([combined], { type: "audio/mpeg" });
}

export async function synthesizeChunk(
  text: string,
  options: TtsSynthesizeOptions,
): Promise<Blob> {
  const provider: TtsProvider = options.provider ?? "openai";

  const voice =
    provider === "deepgram"
      ? (options.deepgramTtsVoice ?? "aura-asteria-en")
      : options.voice;

  const response = await fetch("/api/voice/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice,
      speed: options.speed,
      hd: provider === "openai" ? options.hd === true : undefined,
      openAiTtsModel: options.openAiTtsModel,
      googleTtsQuality: options.googleTtsQuality,
      provider,
    }),
    signal: options.signal,
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "Speech synthesis failed";
    throw new Error(message);
  }

  if (provider === "deepgram" && response.body) {
    return readStreamToBlob(response.body, options.signal);
  }

  return response.blob();
}
