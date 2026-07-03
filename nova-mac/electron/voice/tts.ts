import type { OpenAiTtsModel, SynthesizeRequest, SynthesizeResult } from "@shared/types";
import { synthesizeWithGoogle } from "./tts-google";

const OPENAI_TTS_VOICES = new Set([
  "marin", "cedar", "coral", "shimmer", "sage", "ash", "ballad",
  "verse", "nova", "alloy", "echo", "fable", "onyx",
]);
const DEFAULT_VOICE = "coral";
const MAX_TTS_CHARS = 4096;
const TTS_INSTRUCTIONS_STANDARD =
  "Speak naturally and clearly, like a helpful human assistant in a casual conversation. Warm tone, natural pacing, not robotic.";
const TTS_INSTRUCTIONS_HD =
  "Speak with rich, warm expressiveness like a thoughtful human companion. Natural rhythm, subtle emphasis, and relaxed pacing — never stiff or synthetic.";

export async function synthesizeWithOpenAi(
  text: string, voice: string, speed: number, useHd: boolean,
  model: OpenAiTtsModel = "gpt-4o-mini-tts",
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI TTS is not configured (OPENAI_API_KEY).");
  if (!text) throw new Error("text is required");
  if (text.length > MAX_TTS_CHARS) throw new Error(`text exceeds ${MAX_TTS_CHARS} characters`);

  const selectedVoice = OPENAI_TTS_VOICES.has(voice) ? voice : DEFAULT_VOICE;
  const isModern = model === "gpt-4o-mini-tts";
  const body = isModern
    ? { model, input: text, voice: selectedVoice, speed, response_format: "mp3",
        instructions: useHd ? TTS_INSTRUCTIONS_HD : TTS_INSTRUCTIONS_STANDARD }
    : { model, input: text, voice: selectedVoice, speed, response_format: "mp3" };

  const send = (b: Record<string, unknown>) =>
    fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });

  let response = await send(body);
  if (!response.ok && isModern) {
    response = await send({
      model: useHd ? "tts-1-hd" : "tts-1", input: text, voice: selectedVoice,
      speed, response_format: "mp3",
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
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeWithDeepgram(text: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error("Deepgram TTS is not configured (DEEPGRAM_API_KEY).");
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
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
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
  const provider = req.provider ?? "openai";
  let audio: Buffer;
  if (provider === "google") {
    audio = await synthesizeWithGoogle(req.text, req.voice, req.speed, req.googleTtsQuality);
  } else if (provider === "deepgram") {
    audio = await synthesizeWithDeepgram(req.text, req.voice);
  } else {
    audio = await synthesizeWithOpenAi(req.text, req.voice, req.speed, req.hd === true);
  }
  return { audioBase64: audio.toString("base64") };
}
