import { ipcMain } from "electron";
import { IpcChannel, type AuthState } from "@shared/types";

export interface IpcHandlers {
  ping(): Promise<string>;
  authStatus?(): Promise<AuthState>;
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle(IpcChannel.Ping, () => handlers.ping());
  if (handlers.authStatus) {
    ipcMain.handle(IpcChannel.AuthStatus, () => handlers.authStatus!());
  }
}
