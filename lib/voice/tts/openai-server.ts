import { MAX_TTS_CHARS, OPENAI_TTS_VOICES } from "@/lib/voice/tts/types";
import type { OpenAiTtsModel } from "@/lib/voice/types";

const ALLOWED_VOICES = new Set<string>(OPENAI_TTS_VOICES);
const DEFAULT_VOICE = "coral";

const TTS_INSTRUCTIONS_STANDARD =
  "Speak naturally and clearly, like a helpful human assistant in a casual conversation. Warm tone, natural pacing, not robotic.";

const TTS_INSTRUCTIONS_HD =
  "Speak with rich, warm expressiveness like a thoughtful human companion. Natural rhythm, subtle emphasis, and relaxed pacing — never stiff or synthetic.";

async function requestSpeech(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function buildModernBody(
  model: string,
  text: string,
  voice: string,
  speed: number,
  useHd: boolean,
): Record<string, unknown> {
  return {
    model,
    input: text,
    voice,
    speed,
    response_format: "mp3",
    instructions: useHd ? TTS_INSTRUCTIONS_HD : TTS_INSTRUCTIONS_STANDARD,
  };
}

export async function synthesizeWithOpenAi(
  text: string,
  voice: string,
  speed: number,
  useHd: boolean,
  model: OpenAiTtsModel = "gpt-4o-mini-tts",
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI TTS is not configured on the server.");
  }

  if (!text) {
    throw new Error("text is required");
  }

  if (text.length > MAX_TTS_CHARS) {
    throw new Error(`text exceeds ${MAX_TTS_CHARS} characters per request`);
  }

  const selectedVoice =
    typeof voice === "string" && ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE;

  const selectedModel =
    (process.env.OPENAI_TTS_MODEL?.trim() as OpenAiTtsModel | undefined) ||
    model;

  const isModern = selectedModel === "gpt-4o-mini-tts";
  const body = isModern
    ? buildModernBody(selectedModel, text, selectedVoice, speed, useHd)
    : {
        model: selectedModel,
        input: text,
        voice: selectedVoice,
        speed,
        response_format: "mp3",
      };

  let response = await requestSpeech(apiKey, body);

  if (!response.ok && isModern) {
    const legacyModel: OpenAiTtsModel = useHd ? "tts-1-hd" : "tts-1";
    response = await requestSpeech(apiKey, {
      model: legacyModel,
      input: text,
      voice: selectedVoice,
      speed,
      response_format: "mp3",
    });
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message)
        : "Speech synthesis failed";
    throw new Error(message);
  }

  const audio = await response.arrayBuffer();
  return Buffer.from(audio);
}
