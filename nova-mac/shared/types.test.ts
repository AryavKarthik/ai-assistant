import { describe, it, expect } from "vitest";
import { IpcChannel } from "./types";

describe("IpcChannel", () => {
  it("defines the foundation channels", () => {
    expect(IpcChannel.Ping).toBe("ping");
    expect(IpcChannel.AuthStatus).toBe("auth:status");
    expect(IpcChannel.AuthSignIn).toBe("auth:signIn");
    expect(IpcChannel.SyncConversations).toBe("sync:conversations");
  });
});
