import type { GoogleVoiceQuality, OpenAiTtsModel, TtsProvider } from "@/lib/voice/types";
import {
  GOOGLE_TTS_VOICES,
  type GoogleTtsVoice,
  parseGoogleVoiceQuality,
} from "@/lib/voice/google-quality";

export type { TtsProvider } from "@/lib/voice/types";
export { GOOGLE_TTS_VOICES, type GoogleTtsVoice, parseGoogleVoiceQuality };

export const MAX_TTS_CHARS = 4096;

export const OPENAI_TTS_VOICES = [
  "marin",
  "cedar",
  "coral",
  "shimmer",
  "sage",
  "ash",
  "ballad",
  "verse",
  "nova",
  "alloy",
  "echo",
  "fable",
  "onyx",
] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

export const DEEPGRAM_TTS_VOICES = [
  // Aura-2 (newer, higher quality)
  "aura-2-asteria-en",
  "aura-2-luna-en",
  "aura-2-stella-en",
  "aura-2-hera-en",
  "aura-2-orion-en",
  "aura-2-arcas-en",
  "aura-2-zeus-en",
  "aura-2-perseus-en",
  "aura-2-angus-en",
  "aura-2-helios-en",
  "aura-2-orpheus-en",
  // Aura (original)
  "aura-asteria-en",
  "aura-luna-en",
  "aura-stella-en",
  "aura-hera-en",
  "aura-orion-en",
  "aura-arcas-en",
  "aura-zeus-en",
  "aura-perseus-en",
  "aura-angus-en",
  "aura-helios-en",
  "aura-orpheus-en",
] as const;

export type DeepgramTtsVoice = (typeof DEEPGRAM_TTS_VOICES)[number];

export interface TtsSynthesizeOptions {
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: TtsProvider;
  openAiTtsModel?: OpenAiTtsModel;
  googleTtsQuality?: GoogleVoiceQuality;
  deepgramTtsVoice?: string;
  signal?: AbortSignal;
}

export function parseTtsProvider(value: unknown): TtsProvider {
  return value === "google" ? "google" : value === "deepgram" ? "deepgram" : "openai";
}

const OPENAI_TTS_MODELS: OpenAiTtsModel[] = [
  "gpt-4o-mini-tts",
  "tts-1",
  "tts-1-hd",
];

export function parseOpenAiTtsModel(value: unknown): OpenAiTtsModel {
  return OPENAI_TTS_MODELS.includes(value as OpenAiTtsModel)
    ? (value as OpenAiTtsModel)
    : "gpt-4o-mini-tts";
}
