import { contextBridge, ipcRenderer } from "electron";
import { AuthState, IpcChannel } from "@shared/types";

contextBridge.exposeInMainWorld("nova", {
  ping: () => ipcRenderer.invoke(IpcChannel.Ping),
  authStatus: () => ipcRenderer.invoke(IpcChannel.AuthStatus),
  authSignIn: (email: string) => ipcRenderer.invoke(IpcChannel.AuthSignIn, email),
  authSignOut: () => ipcRenderer.invoke(IpcChannel.AuthSignOut),
  onAuthChanged: (cb: (s: unknown) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, s: unknown) => cb(s as AuthState);
    ipcRenderer.on(IpcChannel.AuthChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannel.AuthChanged, handler);
  },
  syncConversations: () => ipcRenderer.invoke(IpcChannel.SyncConversations),
  syncMemories: () => ipcRenderer.invoke(IpcChannel.SyncMemories),
  transcribe: (req: unknown, provider: unknown) =>
    ipcRenderer.invoke(IpcChannel.VoiceTranscribe, req, provider),
  synthesize: (req: unknown) => ipcRenderer.invoke(IpcChannel.VoiceSynthesize, req),
});
