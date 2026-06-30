import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from "electron";
import { registerIpcHandlers } from "./ipc";
import { IpcChannel } from "@shared/types";

describe("registerIpcHandlers", () => {
  it("registers a handler for every provided channel", () => {
    registerIpcHandlers({
      ping: async () => "pong",
      authStatus: async () => ({ signedIn: false, email: null }),
      authSignIn: async () => {},
      authSignOut: async () => {},
      syncConversations: async () => [],
      syncMemories: async () => [],
      transcribe: async () => "",
    });
    expect(ipcMain.handle).toHaveBeenCalledWith(IpcChannel.Ping, expect.any(Function));
  });
});
