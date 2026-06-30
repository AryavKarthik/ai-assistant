import { ipcMain, type WebContents } from "electron";
import { IpcChannel, type AuthState, type ConversationSummary, type MemorySummary } from "@shared/types";

export interface IpcHandlers {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
  syncConversations(): Promise<ConversationSummary[]>;
  syncMemories(): Promise<MemorySummary[]>;
  transcribe(req: import("@shared/types").TranscribeRequest, provider: import("@shared/types").SttProvider): Promise<string>;
  synthesize(req: import("@shared/types").SynthesizeRequest): Promise<import("@shared/types").SynthesizeResult>;
  getVoicePreferences(): Promise<import("@shared/types").VoicePreferences>;
}

export interface ChatBridge {
  start(req: import("@shared/types").ChatSendRequest, sender: WebContents): void;
  cancel(requestId: string): void;
}

export function registerChatBridge(bridge: ChatBridge): void {
  ipcMain.on(IpcChannel.ChatSend, (e, req) => bridge.start(req, e.sender));
  ipcMain.on(IpcChannel.ChatCancel, (_e, requestId: string) => bridge.cancel(requestId));
}

export interface WakeBridge {
  pushFrame(buf: ArrayBuffer): void;
  setEnabled(on: boolean): void;
}

export function registerWakeBridge(bridge: WakeBridge): void {
  ipcMain.on(IpcChannel.WakeAudioFrame, (_e, buf: ArrayBuffer) => bridge.pushFrame(buf));
  ipcMain.on(IpcChannel.WakeSetEnabled, (_e, on: boolean) => bridge.setEnabled(on));
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle(IpcChannel.Ping, () => handlers.ping());
  ipcMain.handle(IpcChannel.AuthStatus, () => handlers.authStatus());
  ipcMain.handle(IpcChannel.AuthSignIn, (_e, email: string) => handlers.authSignIn(email));
  ipcMain.handle(IpcChannel.AuthSignOut, () => handlers.authSignOut());
  ipcMain.handle(IpcChannel.SyncConversations, () => handlers.syncConversations());
  ipcMain.handle(IpcChannel.SyncMemories, () => handlers.syncMemories());
  ipcMain.handle(IpcChannel.VoiceTranscribe, (_e, req, provider) => handlers.transcribe(req, provider));
  ipcMain.handle(IpcChannel.VoiceSynthesize, (_e, req) => handlers.synthesize(req));
  ipcMain.handle(IpcChannel.VoiceGetPreferences, () => handlers.getVoicePreferences());
}
