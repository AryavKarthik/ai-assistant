import type { AuthState } from "@shared/types";

export interface NovaBridge {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
  onAuthChanged(cb: (s: AuthState) => void): void;
}

declare global {
  interface Window { nova: NovaBridge }
}

export const nova = (): NovaBridge => window.nova;
