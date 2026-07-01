import type { GoogleSttModel, GoogleVoiceQuality } from "@/lib/voice/types";

export const GOOGLE_VOICE_QUALITY_OPTIONS: {
  id: GoogleVoiceQuality;
  label: string;
  description: string;
}[] = [
  {
    id: "low",
    label: "Low",
    description: "Fastest and cheapest — Standard voices, short-form STT",
  },
  {
    id: "medium",
    label: "Medium",
    description: "Balanced — Neural2 voices, conversation STT",
  },
  {
    id: "high",
    label: "High",
    description: "Best quality — Chirp 3 HD voices, Chirp 2 STT",
  },
];

export const GOOGLE_TTS_VOICES_LOW = [
  "en-AU-Standard-A",
  "en-AU-Standard-B",
  "en-AU-Standard-C",
  "en-AU-Standard-D",
  "en-AU-Wavenet-A",
  "en-AU-Wavenet-B",
  "en-AU-Wavenet-C",
  "en-AU-Wavenet-D",
  "en-US-Standard-A",
  "en-US-Standard-B",
  "en-US-Standard-C",
  "en-US-Standard-D",
  "en-US-Standard-E",
  "en-US-Standard-F",
  "en-US-Standard-G",
  "en-US-Standard-H",
  "en-US-Standard-I",
  "en-US-Standard-J",
  "en-US-Wavenet-A",
  "en-US-Wavenet-B",
  "en-US-Wavenet-C",
  "en-US-Wavenet-D",
  "en-US-Wavenet-E",
  "en-US-Wavenet-F",
  "en-US-Wavenet-G",
  "en-US-Wavenet-H",
  "en-US-Wavenet-I",
  "en-US-Wavenet-J",
] as const;

export const GOOGLE_TTS_VOICES_MEDIUM = [
  "en-AU-Neural2-A",
  "en-AU-Neural2-B",
  "en-AU-Neural2-C",
  "en-AU-Neural2-D",
  "en-AU-Journey-F",
  "en-AU-Journey-O",
  "en-US-Journey-D",
  "en-US-Journey-F",
  "en-US-Neural2-A",
  "en-US-Neural2-C",
  "en-US-Neural2-D",
  "en-US-Neural2-F",
  "en-US-Neural2-G",
  "en-US-Neural2-H",
  "en-US-Neural2-I",
  "en-US-Neural2-J",
] as const;

export const GOOGLE_TTS_VOICES_HIGH = [
  "en-AU-Chirp-HD-D",
  "en-AU-Chirp-HD-F",
  "en-AU-Chirp-HD-O",
  "en-AU-Chirp3-HD-Achernar",
  "en-AU-Chirp3-HD-Achird",
  "en-AU-Chirp3-HD-Algenib",
  "en-AU-Chirp3-HD-Algieba",
  "en-AU-Chirp3-HD-Alnilam",
  "en-AU-Chirp3-HD-Aoede",
  "en-AU-Chirp3-HD-Autonoe",
  "en-AU-Chirp3-HD-Callirrhoe",
  "en-AU-Chirp3-HD-Charon",
  "en-AU-Chirp3-HD-Despina",
  "en-AU-Chirp3-HD-Enceladus",
  "en-AU-Chirp3-HD-Erinome",
  "en-AU-Chirp3-HD-Fenrir",
  "en-AU-Chirp3-HD-Gacrux",
  "en-AU-Chirp3-HD-Iapetus",
  "en-AU-Chirp3-HD-Kore",
  "en-AU-Chirp3-HD-Laomedeia",
  "en-AU-Chirp3-HD-Leda",
  "en-AU-Chirp3-HD-Orus",
  "en-AU-Chirp3-HD-Puck",
  "en-AU-Chirp3-HD-Pulcherrima",
  "en-AU-Chirp3-HD-Rasalgethi",
  "en-AU-Chirp3-HD-Sadachbia",
  "en-AU-Chirp3-HD-Sadaltager",
  "en-AU-Chirp3-HD-Schedar",
  "en-AU-Chirp3-HD-Sulafat",
  "en-AU-Chirp3-HD-Umbriel",
  "en-AU-Chirp3-HD-Vindemiatrix",
  "en-AU-Chirp3-HD-Zephyr",
  "en-AU-Chirp3-HD-Zubenelgenubi",
  "en-US-Chirp3-HD-Achernar",
  "en-US-Chirp3-HD-Achird",
  "en-US-Chirp3-HD-Charon",
  "en-US-Chirp3-HD-Kore",
  "en-US-Chirp3-HD-Leda",
  "en-US-Chirp3-HD-Orus",
  "en-US-Chirp3-HD-Puck",
  "en-US-Chirp3-HD-Zephyr",
] as const;

export const GOOGLE_TTS_VOICES = [
  ...GOOGLE_TTS_VOICES_LOW,
  ...GOOGLE_TTS_VOICES_MEDIUM,
  ...GOOGLE_TTS_VOICES_HIGH,
] as const;

export type GoogleTtsVoice = (typeof GOOGLE_TTS_VOICES)[number];

const DEFAULT_GOOGLE_TTS_VOICE_BY_QUALITY: Record<GoogleVoiceQuality, string> = {
  low: "en-AU-Standard-B",
  medium: "en-AU-Neural2-A",
  high: "en-AU-Chirp3-HD-Kore",
};

export function parseGoogleVoiceQuality(value: unknown): GoogleVoiceQuality {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : "medium";
}

export function googleTtsVoicesForQuality(
  quality: GoogleVoiceQuality,
): readonly string[] {
  if (quality === "low") return GOOGLE_TTS_VOICES_LOW;
  if (quality === "high") return GOOGLE_TTS_VOICES_HIGH;
  return GOOGLE_TTS_VOICES_MEDIUM;
}

export function defaultGoogleTtsVoiceForQuality(
  quality: GoogleVoiceQuality,
): string {
  return DEFAULT_GOOGLE_TTS_VOICE_BY_QUALITY[quality];
}

export function googleTtsQualityForVoice(voice: string): GoogleVoiceQuality {
  if ((GOOGLE_TTS_VOICES_HIGH as readonly string[]).includes(voice)) {
    return "high";
  }
  if ((GOOGLE_TTS_VOICES_MEDIUM as readonly string[]).includes(voice)) {
    return "medium";
  }
  if ((GOOGLE_TTS_VOICES_LOW as readonly string[]).includes(voice)) {
    return "low";
  }
  return "medium";
}

export function googleSttQualityFromLegacyModel(
  model: GoogleSttModel | undefined,
): GoogleVoiceQuality {
  if (model === "latest_short") return "low";
  if (model === "chirp_2") return "high";
  return "medium";
}

export interface GoogleSttPipelineConfig {
  api: "v1" | "v2";
  model: GoogleSttModel;
  useEnhanced: boolean;
}

export function resolveGoogleSttPipeline(
  quality: GoogleVoiceQuality,
): GoogleSttPipelineConfig {
  if (quality === "low") {
    return { api: "v1", model: "latest_short", useEnhanced: false };
  }
  if (quality === "high") {
    return { api: "v2", model: "chirp_2", useEnhanced: true };
  }
  return { api: "v1", model: "latest_long", useEnhanced: true };
}

export function googleSttQualityFromLegacyFields(
  quality: unknown,
  model: unknown,
): GoogleVoiceQuality {
  if (quality === "low" || quality === "medium" || quality === "high") {
    return quality;
  }
  return googleSttQualityFromLegacyModel(
    model === "latest_short" ||
      model === "latest_long" ||
      model === "chirp_2"
      ? model
      : undefined,
  );
}

export function googleTtsQualityFromLegacyFields(
  quality: unknown,
  voice: unknown,
): GoogleVoiceQuality {
  if (quality === "low" || quality === "medium" || quality === "high") {
    return quality;
  }
  if (typeof voice === "string") {
    return googleTtsQualityForVoice(voice);
  }
  return "high";
}

export function normalizeGoogleTtsVoice(
  voice: string,
  quality: GoogleVoiceQuality,
): string {
  const allowed = googleTtsVoicesForQuality(quality);
  if (allowed.includes(voice)) {
    return voice;
  }
  return defaultGoogleTtsVoiceForQuality(quality);
}
