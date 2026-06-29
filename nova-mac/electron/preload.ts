import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/types";

contextBridge.exposeInMainWorld("nova", {
  ping: () => ipcRenderer.invoke(IpcChannel.Ping),
  authStatus: () => ipcRenderer.invoke(IpcChannel.AuthStatus),
  authSignIn: (email: string) => ipcRenderer.invoke(IpcChannel.AuthSignIn, email),
  authSignOut: () => ipcRenderer.invoke(IpcChannel.AuthSignOut),
  onAuthChanged: (cb: (s: unknown) => void) =>
    ipcRenderer.on(IpcChannel.AuthChanged, (_e, s) => cb(s)),
});
