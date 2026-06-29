export enum IpcChannel {
  Ping = "ping",
  AuthStatus = "auth:status",
  AuthSignIn = "auth:signIn",
  AuthSignOut = "auth:signOut",
  AuthChanged = "auth:changed",
  SyncConversations = "sync:conversations",
  SyncMemories = "sync:memories",
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
  type: string;
  salience: number;
}
