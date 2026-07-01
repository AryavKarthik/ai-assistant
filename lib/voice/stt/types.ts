import type {
  GoogleSttModel,
  GoogleVoiceQuality,
  OpenAiSttModel,
  SttProvider,
} from "@/lib/voice/types";
import { parseGoogleVoiceQuality } from "@/lib/voice/google-quality";

export type { SttProvider } from "@/lib/voice/types";
export { parseGoogleVoiceQuality };

export interface TranscribeAudioInput {
  audio: Buffer;
  mimeType: string;
}

export interface TranscribeOptions {
  openAiModel?: OpenAiSttModel;
  googleModel?: GoogleSttModel;
  googleQuality?: GoogleVoiceQuality;
}

export function parseSttProvider(value: unknown): SttProvider {
  return value === "google" ? "google" : "openai";
}

const OPENAI_STT_MODELS: OpenAiSttModel[] = [
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
];

const GOOGLE_STT_MODELS: GoogleSttModel[] = [
  "latest_long",
  "latest_short",
  "chirp_2",
];

export function parseOpenAiSttModel(value: unknown): OpenAiSttModel {
  return OPENAI_STT_MODELS.includes(value as OpenAiSttModel)
    ? (value as OpenAiSttModel)
    : "gpt-4o-transcribe";
}

export function parseGoogleSttModel(value: unknown): GoogleSttModel {
  return GOOGLE_STT_MODELS.includes(value as GoogleSttModel)
    ? (value as GoogleSttModel)
    : "latest_long";
}
