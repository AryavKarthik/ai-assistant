export enum IpcChannel {
  Ping = "ping",
  AuthStatus = "auth:status",
  AuthSignIn = "auth:signIn",
  AuthSignOut = "auth:signOut",
  AuthChanged = "auth:changed",
  SyncConversations = "sync:conversations",
  SyncMemories = "sync:memories",
  // Wake word
  WakeAudioFrame = "wake:audioFrame",
  WakeDetected = "wake:detected",
  WakeSetEnabled = "wake:setEnabled",
  // Voice (STT/TTS)
  VoiceTranscribe = "voice:transcribe",
  VoiceSynthesize = "voice:synthesize",
  VoiceGetPreferences = "voice:getPreferences",
  VoiceTurnEnded = "voice:turnEnded",
  // Chat streaming
  ChatSend = "chat:send",
  ChatDelta = "chat:delta",
  ChatDone = "chat:done",
  ChatError = "chat:error",
  ChatCancel = "chat:cancel",
  ChatToolUse = "chat:toolUse",
  // Timers (main-process timer manager)
  TimerFired = "timer:fired",
  // Window management
  GetWindowMode = "window:get-mode",
  AppOpen = "app:open",
  AppClose = "app:close",
  // Preferences push
  PrefsChanged = "prefs:changed",
  // Prefs get/set (used by Settings tab — wired in Task 7)
  PrefsGet = "prefs:get",
  PrefsSet = "prefs:set",
  // Connections (wired in Task 10)
  ConnectionsStatus = "connections:status",
  ConnectionsConnect = "connections:connect",
  ConnectionsDisconnect = "connections:disconnect",
  ConnectionsCallback = "connections:callback",
  YoutubeRefreshTaste = "youtube:refresh-taste",
  // Reminders (wired in Task 8)
  RemindersGet = "reminders:get",
  RemindersDone = "reminders:done",
  RemindersDelete = "reminders:delete",
  // Memory (wired in Task 9)
  MemorySearch = "memory:search",
  MemoryPin = "memory:pin",
  MemoryArchive = "memory:archive",
  MemoryDelete = "memory:delete",
}

export interface AuthState {
  signedIn: boolean;
  email: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface MemorySummary {
  id: string;
  content: string;
  memoryType: string | null;
  salience: number;
}

export type OrbStateName =
  | "dormant"
  | "listening"
  | "processing"
  | "responding"
  | "working"
  | "bargeIn";

/** Int16 PCM, 16 kHz mono, one ~80ms frame (1280 samples). */
export interface WakeFrame {
  /** Transferable ArrayBuffer of Int16 little-endian samples. */
  samples: ArrayBuffer;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSendRequest {
  requestId: string;
  messages: ChatMessage[];
  inputModality?: "voice" | "text";
}

export interface ChatStreamDelta {
  requestId: string;
  delta: string;
}
export interface ChatStreamDone {
  requestId: string;
  text: string;
}
export interface ChatStreamError {
  requestId: string;
  message: string;
}
/** Emitted when Claude starts running a tool mid-turn so the UI can show progress. */
export interface ChatToolUseEvent {
  requestId: string;
  toolName: string;
  /** Human-friendly step label, e.g. "Checking your calendar…". */
  step: string;
}

export interface TimerFiredEvent {
  id: string;
  label: string;
}

export interface TranscribeRequest {
  /** base64-encoded audio bytes. */
  audioBase64: string;
  mimeType: string;
}

export interface SynthesizeRequest {
  text: string;
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: TtsProvider;
}
export interface SynthesizeResult {
  /** base64-encoded MP3 bytes. */
  audioBase64: string;
}

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
  bargeInSilenceMs: number;
  bargeInAbortMs: number;
  bargeInSensitivity: number;
  instantAck: boolean;
  instantAckMode: "off" | "earcon" | "spoken";
  /** Master switch for UI sound cues (wake, thinking, error, timer). */
  audioCuesEnabled: boolean;
  listeningSensitivity: number;
  wakeWordSensitivity: number;
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

export type WindowMode = "orb" | "app";

export interface ProactivePrefs {
  proactiveMode: "off" | "reminders_only" | "full";
  dailyBriefEnabled: boolean;
  briefTimeLocal: string;
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export const DEFAULT_PROACTIVE_PREFS: ProactivePrefs = {
  proactiveMode: "off",
  dailyBriefEnabled: false,
  briefTimeLocal: "08:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

export interface AllPrefs {
  voice: VoicePreferences;
  proactive: ProactivePrefs;
}

export type GoogleService = "calendar" | "gmail" | "youtube";

export interface GoogleConnectionStatus {
  calendar: { connected: boolean; email: string | null };
  gmail: { connected: boolean; email: string | null };
  youtube: { connected: boolean; email: string | null };
}

export interface ReminderItem {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  memoryType: string | null;
  salience: number;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  interactionMode: "wake_word",
  autoSendOnEndOfTurn: true,
  silenceMs: 900,
  spokenReplies: true,
  bargeInEnabled: true,
  bargeInSilenceMs: 1400,
  bargeInAbortMs: 3000,
  bargeInSensitivity: 0.45,
  instantAck: true,
  instantAckMode: "earcon",
  audioCuesEnabled: true,
  listeningSensitivity: 0.55,
  wakeWordSensitivity: 0.5,
  wakePhrases: ["hey jarvis"],
  sttProvider: "openai",
  openAiSttModel: "gpt-4o-transcribe",
  googleSttModel: "latest_long",
  googleSttQuality: "medium",
  ttsProvider: "openai",
  googleTtsQuality: "high",
  openAiTtsModel: "gpt-4o-mini-tts",
  ttsVoice: "coral",
  googleTtsVoice: "en-AU-Chirp3-HD-Kore",
  deepgramTtsVoice: "aura-orion-en",
  ttsSpeed: 1.1,
  ttsHd: true,
};
