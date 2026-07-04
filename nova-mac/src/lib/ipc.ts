import type { AuthState } from "@shared/types";

export interface NovaBridge {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
  authPasteCallback(url: string): Promise<{ ok: boolean; error?: string }>;
  onAuthChanged(cb: (s: AuthState) => void): () => void;
  syncConversations(): Promise<import("@shared/types").ConversationSummary[]>;
  syncMemories(): Promise<import("@shared/types").MemorySummary[]>;
  transcribe(
    req: import("@shared/types").TranscribeRequest,
    provider: import("@shared/types").SttProvider,
  ): Promise<string>;
  synthesize(
    req: import("@shared/types").SynthesizeRequest,
  ): Promise<import("@shared/types").SynthesizeResult>;
  chatSend(req: import("@shared/types").ChatSendRequest): void;
  chatCancel(requestId: string): void;
  onChatDelta(cb: (p: import("@shared/types").ChatStreamDelta) => void): () => void;
  onChatDone(cb: (p: import("@shared/types").ChatStreamDone) => void): () => void;
  onChatError(cb: (p: import("@shared/types").ChatStreamError) => void): () => void;
  onChatToolUse(cb: (p: import("@shared/types").ChatToolUseEvent) => void): () => void;
  onTimerFired(cb: (p: import("@shared/types").TimerFiredEvent) => void): () => void;
  sendWakeFrame(buf: ArrayBuffer): void;
  setWakeEnabled(on: boolean): void;
  onWakeDetected(cb: () => void): () => void;
  getVoicePreferences(): Promise<import("@shared/types").VoicePreferences>;
  voiceTurnEnded(): void;
  /** A kill phrase ended the turn — stop listening without letting a
   *  system-triggered popup auto-hide itself the way a natural completion would. */
  orbDisarmAutoHide(): void;
  getWindowMode(): Promise<string>;
  /** manual=true for a real user action (click/hotkey) vs a system-driven change (timer notice). */
  orbSetExpanded(on: boolean, manual?: boolean): void;
  onOrbExpandedChanged(cb: (on: boolean) => void): () => void;
  /** Move the orb window by a screen-px delta during a manual pointer drag. */
  orbDragMove(dx: number, dy: number): void;
  /** Toggle OS-level click-through on the orb window (collapsed mode: everything
   *  except the orb itself must let clicks fall through to whatever is beneath). */
  orbSetMouseIgnore(ignore: boolean): void;
  onOrbDragVelocity(cb: (p: import("@shared/types").OrbDragVelocityEvent) => void): () => void;
  appOpen(): void;
  appClose(): void;
  onPrefsChanged(cb: (p: unknown) => void): () => void;
  prefsGet(): Promise<unknown>;
  prefsSet(patch: unknown): Promise<unknown>;
  connectionsStatus(): Promise<unknown>;
  connectionsConnect(req: unknown): Promise<void>;
  connectionsDisconnect(req: unknown): Promise<void>;
  onConnectionsCallback(
    cb: (payload: import("@shared/types").ConnectionsCallbackPayload) => void,
  ): () => void;
  /** Opens a Google streaming STT session; the renderer then forwards
   *  native-rate PCM via sttStreamAudio. Resolves false when unconfigured. */
  sttStreamStart(req: import("@shared/types").SttStreamStartRequest): Promise<boolean>;
  sttStreamAudio(buf: ArrayBuffer): void;
  /** Half-closes the stream and resolves the final transcript. */
  sttStreamStop(): Promise<string>;
  sttStreamAbort(): void;
  youtubeRefreshTaste(): Promise<void>;
  remindersGet(): Promise<unknown>;
  remindersDone(id: string): Promise<void>;
  remindersDelete(id: string): Promise<void>;
  memorySearch(req: unknown): Promise<unknown>;
  memoryPin(req: unknown): Promise<void>;
  memoryArchive(req: unknown): Promise<void>;
  memoryDelete(id: string): Promise<void>;
}

declare global {
  interface Window { nova: NovaBridge }
}

export const nova = (): NovaBridge => window.nova;
