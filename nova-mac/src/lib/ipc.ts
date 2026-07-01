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
  sendWakeFrame(buf: ArrayBuffer): void;
  setWakeEnabled(on: boolean): void;
  onWakeDetected(cb: () => void): () => void;
  getVoicePreferences(): Promise<import("@shared/types").VoicePreferences>;
  voiceTurnEnded(): void;
  // Added in Task 3 — optional here so Task 1 compiles before preload is updated
  onPrefsChanged?: (cb: (p: unknown) => void) => () => void;
}

declare global {
  interface Window { nova: NovaBridge }
}

export const nova = (): NovaBridge => window.nova;
