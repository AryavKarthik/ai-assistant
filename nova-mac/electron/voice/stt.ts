import type { OpenAiSttModel, SttProvider, TranscribeRequest } from "@shared/types";

const DEFAULT_TRANSCRIBE_MODEL: OpenAiSttModel = "gpt-4o-transcribe";
const TRANSCRIBE_PROMPT =
  "Casual spoken commands and questions to a personal AI assistant.";

export async function transcribeWithOpenAi(
  audio: Buffer,
  mimeType: string,
  model: OpenAiSttModel = DEFAULT_TRANSCRIBE_MODEL,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI STT is not configured (OPENAI_API_KEY).");

  const selectedModel =
    process.env.OPENAI_STT_MODEL?.trim() || model || DEFAULT_TRANSCRIBE_MODEL;

  const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, `audio.${mimeType.includes("webm") ? "webm" : "mp4"}`);
  form.append("model", selectedModel);
  form.append("response_format", "json");
  form.append("language", "en");
  if (selectedModel !== "whisper-1") form.append("prompt", TRANSCRIBE_PROMPT);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message)
        : "Transcription failed";
    throw new Error(message);
  }
  const text =
    data && typeof data === "object" && "text" in data
      ? String((data as { text: unknown }).text)
      : "";
  return text.trim();
}

export async function transcribe(
  req: TranscribeRequest,
  provider: SttProvider,
): Promise<string> {
  if (provider === "google") {
    // Seam: Google STT requires the GCP client + creds; wired in a later plan.
    throw new Error("Google STT is not yet wired on the Mac app.");
  }
  const audio = Buffer.from(req.audioBase64, "base64");
  return transcribeWithOpenAi(audio, req.mimeType);
}
