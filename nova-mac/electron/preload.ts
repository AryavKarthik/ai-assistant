import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/types";

contextBridge.exposeInMainWorld("nova", {
  ping: (): Promise<string> => ipcRenderer.invoke(IpcChannel.Ping),
});
