import { ipcMain } from "electron";
import { IpcChannel, type AuthState, type ConversationSummary, type MemorySummary } from "@shared/types";

export interface IpcHandlers {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
  syncConversations(): Promise<ConversationSummary[]>;
  syncMemories(): Promise<MemorySummary[]>;
  transcribe(req: import("@shared/types").TranscribeRequest, provider: import("@shared/types").SttProvider): Promise<string>;
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle(IpcChannel.Ping, () => handlers.ping());
  ipcMain.handle(IpcChannel.AuthStatus, () => handlers.authStatus());
  ipcMain.handle(IpcChannel.AuthSignIn, (_e, email: string) => handlers.authSignIn(email));
  ipcMain.handle(IpcChannel.AuthSignOut, () => handlers.authSignOut());
  ipcMain.handle(IpcChannel.SyncConversations, () => handlers.syncConversations());
  ipcMain.handle(IpcChannel.SyncMemories, () => handlers.syncMemories());
  ipcMain.handle(IpcChannel.VoiceTranscribe, (_e, req, provider) => handlers.transcribe(req, provider));
}
