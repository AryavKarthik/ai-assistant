export enum IpcChannel {
  Ping = "ping",
  AuthStatus = "auth:status",
  AuthSignIn = "auth:signIn",
  AuthSignOut = "auth:signOut",
  AuthChanged = "auth:changed",
  // Manual login fallback: paste the nova://auth-callback URL from the browser
  // when the OS deep-link handoff doesn't route (common in dev).
  AuthPasteCallback = "auth:pasteCallback",
  // Email + password sign-in (the normal, deep-link-free path).
  AuthSignInPassword = "auth:signInPassword",
  AuthSetPassword = "auth:setPassword",
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
  // Streaming STT: the renderer forwards native-rate PCM frames (from the
  // capture worklet) over SttStreamAudio between Start and Stop; Stop
  // resolves the transcript.
  SttStreamStart = "stt:streamStart",
  SttStreamAudio = "stt:streamAudio",
  SttStreamStop = "stt:streamStop",
  SttStreamAbort = "stt:streamAbort",
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
  /** Renderer asks main to grow/shrink the orb window (mini orb ↔ chat panel). */
  OrbSetExpanded = "orb:setExpanded",
  /** Main broadcasts the orb window's current expanded state. */
  OrbExpandedChanged = "orb:expandedChanged",
  /** Main broadcasts live drag velocity while the user is dragging the orb window. */
  OrbDragVelocity = "orb:dragVelocity",
  /** Renderer streams pointer-drag deltas so main moves the orb window (manual drag —
   *  a CSS drag region would swallow the mouseup on macOS and break click detection). */
  OrbDragMove = "orb:dragMove",
  /** Renderer toggles OS-level click-through on the orb window. The window is always
   *  panel-sized; while collapsed everything but the orb itself is invisible, so the
   *  window must ignore mouse events (with forwarding, for hover detection) except
   *  when the cursor is over the orb. */
  OrbSetMouseIgnore = "orb:setMouseIgnore",
  /** A kill phrase ("stop", "that's all", ...) ended the turn — stop listening,
   *  but don't auto-hide a system-triggered popup the way a natural turn
   *  completion would; the user is actively engaging with the orb. */
  OrbDisarmAutoHide = "orb:disarmAutoHide",
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
  /** Main asks the orb renderer to speak a proactive announcement aloud
   *  (reminder/calendar pre-alert, timer completion, agent-loop result). */
  ProactiveSpeak = "proactive:speak",
  // Agentic loops (scheduled autonomous prompts, managed in Settings)
  LoopsList = "loops:list",
  LoopsUpsert = "loops:upsert",
  LoopsDelete = "loops:delete",
  LoopsRunNow = "loops:runNow",
  // Learned personality traits (viewed/edited in Settings)
  PersonalityList = "personality:list",
  PersonalityAdd = "personality:add",
  PersonalityUpdate = "personality:update",
  PersonalityDelete = "personality:delete",
  SkillsList = "skills:list",
  SkillsCreate = "skills:create",
  SkillsUpdate = "skills:update",
  SkillsDelete = "skills:delete",
  SkillsRun = "skills:run",
  SkillsPickPath = "skills:pickPath",
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

/** Instantaneous window-drag velocity in pixels/ms, used to drive a jelly
 *  squash-and-stretch wiggle on the orb while the user drags it. */
export interface OrbDragVelocityEvent {
  vx: number;
  vy: number;
}

/** Pointer-drag delta (screen px) the renderer asks main to move the orb window by. */
export interface OrbDragMoveRequest {
  dx: number;
  dy: number;
}

export interface TranscribeRequest {
  /** base64-encoded audio bytes. */
  audioBase64: string;
  mimeType: string;
  /** Only consulted when the provider is "google". */
  googleSttQuality?: GoogleVoiceQuality;
}

export interface SynthesizeRequest {
  text: string;
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: TtsProvider;
  /** Only consulted when the provider is "google". */
  googleTtsQuality?: GoogleVoiceQuality;
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
  /** How long to wait for the user to start speaking before giving up on the
   *  turn entirely (no STT call, no chat call) — the fix for Nova otherwise
   *  sitting there listening to silence/background noise indefinitely. */
  noSpeechTimeoutMs: number;
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

/** Voice-announcement (pre-alert) settings — stored locally on the Mac
 *  (userData JSON), not in Supabase, since they only affect this device. */
export interface AlertPrefs {
  /** Master switch: speak proactive announcements out loud. Off = silent
   *  notifications only. */
  voiceAnnouncementsEnabled: boolean;
  /** Minutes before a reminder's due time to announce it. 0 = at due time.
   *  Each entry fires one spoken announcement. */
  reminderLeadMinutes: number[];
  /** Minutes before a calendar event's start to announce it. */
  calendarLeadMinutes: number[];
  /** Speak "timer's done" when a timer fires (the chime/notice always shows). */
  speakTimerDone: boolean;
  /** Honor the quiet-hours window (ProactivePrefs.quietHoursStart/End):
   *  inside it, announcements become silent notifications. */
  quietHoursEnabled: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  voiceAnnouncementsEnabled: true,
  reminderLeadMinutes: [10, 0],
  calendarLeadMinutes: [10],
  speakTimerDone: true,
  quietHoursEnabled: true,
};

export interface AllPrefs {
  voice: VoicePreferences;
  proactive: ProactivePrefs;
  alerts: AlertPrefs;
}

/** A proactive spoken announcement pushed from main to the orb renderer. */
export interface ProactiveSpeakEvent {
  id: string;
  kind: "reminder" | "calendar" | "timer" | "loop";
  /** Text to show in the orb panel. Empty when another channel already shows
   *  it (timer notices come via TimerFired). */
  noticeText: string;
  /** Text to speak aloud. Empty when voice announcements are muted or quiet
   *  hours are active — the notice still shows. */
  speechText: string;
}

// ── Agentic loops ────────────────────────────────────────────────────────────
// A loop is a natural-language instruction Nova runs autonomously on a
// schedule — a full tool-enabled chat turn whose result is spoken/notified.

export type LoopSchedule =
  | { kind: "once"; at: string } // ISO datetime
  | { kind: "daily"; timeLocal: string } // "HH:MM" local time
  | { kind: "interval"; everyMinutes: number };

export interface AgentLoop {
  id: string;
  name: string;
  instruction: string;
  schedule: LoopSchedule;
  enabled: boolean;
  /** Speak the result aloud when the loop runs (quiet hours still apply). */
  speakResult: boolean;
  createdAt: string;
  lastRunAt: string | null;
  /** Short outcome of the last run (assistant text or error). */
  lastResult: string | null;
  /** Next scheduled run (ISO), null when exhausted (a finished "once"). */
  nextRunAt: string | null;
}

export interface LoopUpsertRequest {
  /** Omitted for create. */
  id?: string;
  name: string;
  instruction: string;
  schedule: LoopSchedule;
  enabled: boolean;
  speakResult: boolean;
}

// ── Learned personality traits ───────────────────────────────────────────────

export interface PersonalityTrait {
  id: string;
  /** The trait/style note itself, e.g. "Swears freely" or "Calls the user Ary". */
  text: string;
  createdAt: string;
  /** "chat" = learned from feedback mid-conversation; "manual" = added in Settings. */
  source: "chat" | "manual";
}

export type SkillAction =
  | { type: "open_path"; path: string }
  | { type: "open_app"; app_name: string }
  | { type: "open_url"; url: string }
  | { type: "run_shortcut"; name: string; input?: string };

export interface CustomSkill {
  id: string;
  name: string;
  triggers: string[];
  actions: SkillAction[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GoogleService = "calendar" | "gmail" | "youtube";

export interface GoogleConnectionStatus {
  calendar: { connected: boolean; email: string | null };
  gmail: { connected: boolean; email: string | null };
  youtube: { connected: boolean; email: string | null };
}

/** Opens a streaming STT session; audio arrives on SttStreamAudio as Int16
 *  mono PCM at this rate. */
export interface SttStreamStartRequest {
  sampleRateHertz: number;
}

/** Result of an OAuth deep-link callback, broadcast on ConnectionsCallback. */
export interface ConnectionsCallbackPayload {
  ok: boolean;
  service?: GoogleService;
  /** Human-readable failure description when ok is false. */
  error?: string;
  /** Actionable fix steps to surface in the UI. */
  hint?: string;
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
  // 750ms of silence ends the utterance. 900 read as the assistant "hanging"
  // after you finished a sentence; with streaming STT the transcript is ready
  // the moment this fires, so a shorter window is mostly pure win — but 650
  // clipped trailing words for natural speakers (paired with release-threshold
  // hysteresis in recordUntilSilence). Raise it in Settings → Conversation if
  // it still cuts you off mid-thought.
  silenceMs: 750,
  noSpeechTimeoutMs: 5000,
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
