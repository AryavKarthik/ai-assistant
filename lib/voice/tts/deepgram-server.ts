const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/speak";

export async function synthesizeWithDeepgram(
  text: string,
  voice: string,
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Deepgram TTS is not configured. Set DEEPGRAM_API_KEY.",
    );
  }

  const url = `${DEEPGRAM_API_URL}?model=${encodeURIComponent(voice)}&encoding=mp3&container=mp3&sample_rate=48000`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "err_msg" in data
        ? String((data as { err_msg: unknown }).err_msg)
        : "Deepgram speech synthesis failed";
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("Deepgram returned empty response body.");
  }

  return response.body as ReadableStream<Uint8Array>;
}
