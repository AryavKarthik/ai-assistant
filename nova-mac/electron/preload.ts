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
  chatSend: (req: unknown) => ipcRenderer.send(IpcChannel.ChatSend, req),
  chatCancel: (requestId: string) => ipcRenderer.send(IpcChannel.ChatCancel, requestId),
  onChatDelta: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatDelta, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatDelta, h);
  },
  onChatDone: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatDone, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatDone, h);
  },
  onChatError: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatError, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatError, h);
  },
  onChatToolUse: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatToolUse, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatToolUse, h);
  },
  onTimerFired: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.TimerFired, h);
    return () => ipcRenderer.removeListener(IpcChannel.TimerFired, h);
  },
  sendWakeFrame: (buf: ArrayBuffer) => ipcRenderer.send(IpcChannel.WakeAudioFrame, buf),
  setWakeEnabled: (on: boolean) => ipcRenderer.send(IpcChannel.WakeSetEnabled, on),
  onWakeDetected: (cb: () => void): (() => void) => {
    const h = () => cb();
    ipcRenderer.on(IpcChannel.WakeDetected, h);
    return () => ipcRenderer.removeListener(IpcChannel.WakeDetected, h);
  },
  getVoicePreferences: () => ipcRenderer.invoke(IpcChannel.VoiceGetPreferences),
  voiceTurnEnded: () => ipcRenderer.send(IpcChannel.VoiceTurnEnded),
  getWindowMode: (): Promise<string> => ipcRenderer.invoke(IpcChannel.GetWindowMode),
  orbSetExpanded: (on: boolean, manual?: boolean) =>
    ipcRenderer.send(IpcChannel.OrbSetExpanded, on, manual),
  onOrbExpandedChanged: (cb: (on: boolean) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, on: boolean) => cb(on);
    ipcRenderer.on(IpcChannel.OrbExpandedChanged, h);
    return () => ipcRenderer.removeListener(IpcChannel.OrbExpandedChanged, h);
  },
  orbDragMove: (dx: number, dy: number) =>
    ipcRenderer.send(IpcChannel.OrbDragMove, { dx, dy }),
  onOrbDragVelocity: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.OrbDragVelocity, h);
    return () => ipcRenderer.removeListener(IpcChannel.OrbDragVelocity, h);
  },
  appOpen: () => ipcRenderer.send(IpcChannel.AppOpen),
  appClose: () => ipcRenderer.send(IpcChannel.AppClose),
  onPrefsChanged: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.PrefsChanged, h);
    return () => ipcRenderer.removeListener(IpcChannel.PrefsChanged, h);
  },
  prefsGet: () => ipcRenderer.invoke(IpcChannel.PrefsGet),
  prefsSet: (patch: unknown) => ipcRenderer.invoke(IpcChannel.PrefsSet, patch),
  connectionsStatus: () => ipcRenderer.invoke(IpcChannel.ConnectionsStatus),
  connectionsConnect: (req: unknown) => ipcRenderer.invoke(IpcChannel.ConnectionsConnect, req),
  connectionsDisconnect: (req: unknown) => ipcRenderer.invoke(IpcChannel.ConnectionsDisconnect, req),
  onConnectionsCallback: (cb: () => void): (() => void) => {
    const h = () => cb();
    ipcRenderer.on(IpcChannel.ConnectionsCallback, h);
    return () => ipcRenderer.removeListener(IpcChannel.ConnectionsCallback, h);
  },
  youtubeRefreshTaste: () => ipcRenderer.invoke(IpcChannel.YoutubeRefreshTaste),
  remindersGet: () => ipcRenderer.invoke(IpcChannel.RemindersGet),
  remindersDone: (id: string) => ipcRenderer.invoke(IpcChannel.RemindersDone, id),
  remindersDelete: (id: string) => ipcRenderer.invoke(IpcChannel.RemindersDelete, id),
  memorySearch: (req: unknown) => ipcRenderer.invoke(IpcChannel.MemorySearch, req),
  memoryPin: (req: unknown) => ipcRenderer.invoke(IpcChannel.MemoryPin, req),
  memoryArchive: (req: unknown) => ipcRenderer.invoke(IpcChannel.MemoryArchive, req),
  memoryDelete: (id: string) => ipcRenderer.invoke(IpcChannel.MemoryDelete, id),
});
