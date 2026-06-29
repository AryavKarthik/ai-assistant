export type VoiceSessionState =
  | "idle"
  | "listening"
  | "processing_stt"
  | "sending"
  | "assistant_streaming"
  | "assistant_speaking";

export type VoiceInteractionMode =
  | "off"
  | "push_to_talk"
  | "conversation"
  | "wake_word";

export type SttProvider = "openai" | "google";
export type TtsProvider = "openai" | "google" | "deepgram";

export type OpenAiSttModel =
  | "gpt-4o-transcribe"
  | "gpt-4o-mini-transcribe"
  | "whisper-1";

export type OpenAiTtsModel = "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";

export type GoogleVoiceQuality = "low" | "medium" | "high";

export type GoogleSttModel = "latest_long" | "latest_short" | "chirp_2";

export interface VoicePreferences {
  interactionMode: VoiceInteractionMode;
  autoSendOnEndOfTurn: boolean;
  silenceMs: number;
  spokenReplies: boolean;
  bargeInEnabled: boolean;
  /** Pause after speech before transcribing during a barge-in interrupt. */
  bargeInSilenceMs: number;
  /** Max time to wait for speech after hands-free interrupt starts. */
  bargeInAbortMs: number;
  /** Hands-free interrupt detection: 0 = strict/slow, 1 = fast/sensitive. */
  bargeInSensitivity: number;
  instantAck: boolean;
  instantAckMode: "off" | "earcon" | "spoken";
  listeningSensitivity: number;
  wakeWordSensitivity: number;
  /** Normalized lowercase phrases, e.g. ["hey nova"]. */
  wakePhrases: string[];
  sttProvider: SttProvider;
  openAiSttModel: OpenAiSttModel;
  googleSttModel: GoogleSttModel;
  googleSttQuality: GoogleVoiceQuality;
  ttsProvider: TtsProvider;
  googleTtsQuality: GoogleVoiceQuality;
  openAiTtsModel: OpenAiTtsModel;
  ttsVoice: string;
  googleTtsVoice: string;
  deepgramTtsVoice: string;
  ttsSpeed: number;
  ttsHd: boolean;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  interactionMode: "wake_word",
  autoSendOnEndOfTurn: true,
  silenceMs: 1500,
  spokenReplies: true,
  bargeInEnabled: true,
  bargeInSilenceMs: 1400,
  bargeInAbortMs: 3000,
  bargeInSensitivity: 0.45,
  instantAck: false,
  instantAckMode: "earcon",
  listeningSensitivity: 0.55,
  wakeWordSensitivity: 0.5,
  wakePhrases: ["hey nova"],
  sttProvider: "openai",
  openAiSttModel: "gpt-4o-transcribe",
  googleSttModel: "latest_long",
  googleSttQuality: "medium",
  ttsProvider: "openai",
  googleTtsQuality: "high",
  openAiTtsModel: "gpt-4o-mini-tts",
  ttsVoice: "coral",
  googleTtsVoice: "en-AU-Chirp3-HD-Kore",
  deepgramTtsVoice: "aura-asteria-en",
  ttsSpeed: 1.1,
  ttsHd: true,
};
