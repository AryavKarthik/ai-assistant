import {
  DEFAULT_VOICE_PREFERENCES,
  type VoiceInteractionMode,
  type VoicePreferences,
} from "@/lib/voice/types";
import {
  googleSttQualityFromLegacyFields,
  googleTtsQualityFromLegacyFields,
  GOOGLE_TTS_VOICES,
  normalizeGoogleTtsVoice,
} from "@/lib/voice/google-quality";
import { parseGoogleSttModel, parseOpenAiSttModel, parseSttProvider } from "@/lib/voice/stt/types";
import {
  resolveWakePhrases,
} from "@/lib/voice/wake/phrases";
import {
  OPENAI_TTS_VOICES,
  parseOpenAiTtsModel,
  parseTtsProvider,
  DEEPGRAM_TTS_VOICES,
} from "@/lib/voice/tts/types";

const STORAGE_KEY = "assistant.voice.preferences";
const VERSION_KEY = "assistant.voice.preferences.version";
const PREFS_VERSION = 12;

const ALLOWED_OPENAI_VOICES = new Set<string>(OPENAI_TTS_VOICES);
const ALLOWED_GOOGLE_VOICES = new Set<string>(GOOGLE_TTS_VOICES);
const ALLOWED_DEEPGRAM_VOICES = new Set<string>(DEEPGRAM_TTS_VOICES);

function isInteractionMode(value: unknown): value is VoiceInteractionMode {
  return (
    value === "off" ||
    value === "push_to_talk" ||
    value === "conversation" ||
    value === "wake_word"
  );
}
export function loadVoicePreferences(): VoicePreferences {
  if (typeof window === "undefined") return DEFAULT_VOICE_PREFERENCES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<VoicePreferences>;
    const merged: VoicePreferences = {
      interactionMode: isInteractionMode(parsed.interactionMode)
        ? parsed.interactionMode
        : DEFAULT_VOICE_PREFERENCES.interactionMode,
      autoSendOnEndOfTurn:
        typeof parsed.autoSendOnEndOfTurn === "boolean"
          ? parsed.autoSendOnEndOfTurn
          : DEFAULT_VOICE_PREFERENCES.autoSendOnEndOfTurn,
      silenceMs:
        typeof parsed.silenceMs === "number" && parsed.silenceMs >= 300
          ? Math.min(3000, parsed.silenceMs)
          : DEFAULT_VOICE_PREFERENCES.silenceMs,
      spokenReplies:
        typeof parsed.spokenReplies === "boolean"
          ? parsed.spokenReplies
          : DEFAULT_VOICE_PREFERENCES.spokenReplies,
      bargeInEnabled:
        typeof parsed.bargeInEnabled === "boolean"
          ? parsed.bargeInEnabled
          : DEFAULT_VOICE_PREFERENCES.bargeInEnabled,
      bargeInSilenceMs:
        typeof parsed.bargeInSilenceMs === "number" &&
        parsed.bargeInSilenceMs >= 500
          ? Math.min(4000, parsed.bargeInSilenceMs)
          : DEFAULT_VOICE_PREFERENCES.bargeInSilenceMs,
      bargeInAbortMs:
        typeof parsed.bargeInAbortMs === "number" && parsed.bargeInAbortMs >= 3000
          ? Math.min(15000, parsed.bargeInAbortMs)
          : DEFAULT_VOICE_PREFERENCES.bargeInAbortMs,
      bargeInSensitivity:
        typeof parsed.bargeInSensitivity === "number" &&
        parsed.bargeInSensitivity >= 0 &&
        parsed.bargeInSensitivity <= 1
          ? parsed.bargeInSensitivity
          : DEFAULT_VOICE_PREFERENCES.bargeInSensitivity,
      instantAck:
        typeof parsed.instantAck === "boolean"
          ? parsed.instantAck
          : DEFAULT_VOICE_PREFERENCES.instantAck,
      instantAckMode:
        parsed.instantAckMode === "off" ||
        parsed.instantAckMode === "earcon" ||
        parsed.instantAckMode === "spoken"
          ? parsed.instantAckMode
          : parsed.instantAck === true
            ? "spoken"
            : DEFAULT_VOICE_PREFERENCES.instantAckMode,
      listeningSensitivity:
        typeof parsed.listeningSensitivity === "number" &&
        parsed.listeningSensitivity >= 0 &&
        parsed.listeningSensitivity <= 1
          ? parsed.listeningSensitivity
          : DEFAULT_VOICE_PREFERENCES.listeningSensitivity,
      wakeWordSensitivity:
        typeof parsed.wakeWordSensitivity === "number" &&
        parsed.wakeWordSensitivity >= 0 &&
        parsed.wakeWordSensitivity <= 1
          ? parsed.wakeWordSensitivity
          : DEFAULT_VOICE_PREFERENCES.wakeWordSensitivity,
      wakePhrases: Array.isArray(parsed.wakePhrases)
        ? resolveWakePhrases(
            parsed.wakePhrases.filter((p): p is string => typeof p === "string"),
          )
        : DEFAULT_VOICE_PREFERENCES.wakePhrases,
      sttProvider: parseSttProvider(parsed.sttProvider),
      openAiSttModel: parseOpenAiSttModel(parsed.openAiSttModel),
      googleSttModel: parseGoogleSttModel(parsed.googleSttModel),
      googleSttQuality: googleSttQualityFromLegacyFields(
        parsed.googleSttQuality,
        parsed.googleSttModel,
      ),
      ttsProvider: parseTtsProvider(parsed.ttsProvider),
      googleTtsQuality: googleTtsQualityFromLegacyFields(
        parsed.googleTtsQuality,
        parsed.googleTtsVoice,
      ),
      openAiTtsModel: parseOpenAiTtsModel(parsed.openAiTtsModel),
      ttsVoice:
        typeof parsed.ttsVoice === "string" &&
        ALLOWED_OPENAI_VOICES.has(parsed.ttsVoice)
          ? parsed.ttsVoice
          : DEFAULT_VOICE_PREFERENCES.ttsVoice,
      googleTtsVoice: normalizeGoogleTtsVoice(
        typeof parsed.googleTtsVoice === "string" &&
          ALLOWED_GOOGLE_VOICES.has(parsed.googleTtsVoice)
          ? parsed.googleTtsVoice
          : DEFAULT_VOICE_PREFERENCES.googleTtsVoice,
        googleTtsQualityFromLegacyFields(
          parsed.googleTtsQuality,
          parsed.googleTtsVoice,
        ),
      ),
      deepgramTtsVoice:
        typeof parsed.deepgramTtsVoice === "string" &&
        ALLOWED_DEEPGRAM_VOICES.has(parsed.deepgramTtsVoice)
          ? parsed.deepgramTtsVoice
          : DEFAULT_VOICE_PREFERENCES.deepgramTtsVoice,
      ttsSpeed:
        typeof parsed.ttsSpeed === "number" &&
        parsed.ttsSpeed >= 0.25 &&
        parsed.ttsSpeed <= 4
          ? parsed.ttsSpeed
          : DEFAULT_VOICE_PREFERENCES.ttsSpeed,
      ttsHd:
        typeof parsed.ttsHd === "boolean"
          ? parsed.ttsHd
          : DEFAULT_VOICE_PREFERENCES.ttsHd,
    };

    const storedVersion = Number(localStorage.getItem(VERSION_KEY) ?? "1");
    if (storedVersion < PREFS_VERSION) {
      if (storedVersion < 2) {
        if (merged.ttsVoice === "nova") {
          merged.ttsVoice = DEFAULT_VOICE_PREFERENCES.ttsVoice;
        }
        if (merged.ttsHd === false) {
          merged.ttsHd = DEFAULT_VOICE_PREFERENCES.ttsHd;
        }
        if (merged.silenceMs === 650) {
          merged.silenceMs = DEFAULT_VOICE_PREFERENCES.silenceMs;
        }
        if (merged.listeningSensitivity === 0.45) {
          merged.listeningSensitivity =
            DEFAULT_VOICE_PREFERENCES.listeningSensitivity;
        }
      }
      if (storedVersion < 3) {
        if (!parsed.openAiSttModel) {
          merged.openAiSttModel = DEFAULT_VOICE_PREFERENCES.openAiSttModel;
        }
        if (!parsed.googleSttModel) {
          merged.googleSttModel = DEFAULT_VOICE_PREFERENCES.googleSttModel;
        }
        if (!parsed.openAiTtsModel) {
          merged.openAiTtsModel = DEFAULT_VOICE_PREFERENCES.openAiTtsModel;
        }
      }
      if (storedVersion < 4) {
        merged.bargeInSilenceMs = DEFAULT_VOICE_PREFERENCES.bargeInSilenceMs;
        merged.bargeInAbortMs = DEFAULT_VOICE_PREFERENCES.bargeInAbortMs;
        merged.bargeInSensitivity = DEFAULT_VOICE_PREFERENCES.bargeInSensitivity;
      }
      if (storedVersion < 5) {
        merged.googleSttQuality = googleSttQualityFromLegacyFields(
          parsed.googleSttQuality,
          parsed.googleSttModel,
        );
        merged.googleTtsQuality = googleTtsQualityFromLegacyFields(
          parsed.googleTtsQuality,
          parsed.googleTtsVoice,
        );
        merged.googleTtsVoice = normalizeGoogleTtsVoice(
          merged.googleTtsVoice,
          merged.googleTtsQuality,
        );
      }
      if (storedVersion < 6) {
        merged.wakePhrases = resolveWakePhrases(
          Array.isArray(parsed.wakePhrases)
            ? parsed.wakePhrases.filter((p): p is string => typeof p === "string")
            : undefined,
        );
      }
      if (storedVersion < 7 && merged.interactionMode === "off") {
        merged.interactionMode = DEFAULT_VOICE_PREFERENCES.interactionMode;
      }
      if (storedVersion < 8 && merged.silenceMs < 2000) {
        merged.silenceMs = 2000;
      }
      if (storedVersion < 9 && merged.silenceMs === 2000) {
        merged.silenceMs = DEFAULT_VOICE_PREFERENCES.silenceMs;
      }
      if (storedVersion < 10 && merged.ttsSpeed === 0.95) {
        merged.ttsSpeed = DEFAULT_VOICE_PREFERENCES.ttsSpeed;
      }
      if (storedVersion < 11 && !parsed.deepgramTtsVoice) {
        merged.deepgramTtsVoice = DEFAULT_VOICE_PREFERENCES.deepgramTtsVoice;
      }
      if (storedVersion < 12 && (merged.deepgramTtsVoice.startsWith("aura-2-") || merged.deepgramTtsVoice === "aura-asteria-en")) {
        merged.deepgramTtsVoice = DEFAULT_VOICE_PREFERENCES.deepgramTtsVoice;
      }
      saveVoicePreferences(merged);
      localStorage.setItem(VERSION_KEY, String(PREFS_VERSION));
    }

    return merged;
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}

export function saveVoicePreferences(prefs: VoicePreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
