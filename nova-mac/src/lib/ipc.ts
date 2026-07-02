import type { AuthState } from "@shared/types";

export interface NovaBridge {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
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
  getWindowMode(): Promise<string>;
  /** manual=true for a real user action (click/hotkey) vs a system-driven change (timer notice). */
  orbSetExpanded(on: boolean, manual?: boolean): void;
  onOrbExpandedChanged(cb: (on: boolean) => void): () => void;
  onOrbDragVelocity(cb: (p: import("@shared/types").OrbDragVelocityEvent) => void): () => void;
  appOpen(): void;
  appClose(): void;
  onPrefsChanged(cb: (p: unknown) => void): () => void;
  prefsGet(): Promise<unknown>;
  prefsSet(patch: unknown): Promise<unknown>;
  connectionsStatus(): Promise<unknown>;
  connectionsConnect(req: unknown): Promise<void>;
  connectionsDisconnect(req: unknown): Promise<void>;
  onConnectionsCallback(cb: () => void): () => void;
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
