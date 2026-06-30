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
}

declare global {
  interface Window { nova: NovaBridge }
}

export const nova = (): NovaBridge => window.nova;
