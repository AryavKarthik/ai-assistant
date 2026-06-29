import { describe, it, expect, vi, beforeEach } from "vitest";

const files: Record<string, string> = {};
vi.mock("node:fs", () => ({
  writeFileSync: (p: string, d: string) => { files[p] = d; },
  readFileSync: (p: string) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
  existsSync: (p: string) => p in files,
  rmSync: (p: string) => { delete files[p]; },
}));
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nova-test" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from("enc:" + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
  },
}));

import { saveSession, loadSession, clearSession } from "./session-store";

beforeEach(() => { for (const k of Object.keys(files)) delete files[k]; });

describe("session-store", () => {
  it("returns null when nothing is stored", () => {
    expect(loadSession()).toBeNull();
  });
  it("round-trips a session through encryption", () => {
    saveSession({ access_token: "a", refresh_token: "r" });
    expect(loadSession()).toEqual({ access_token: "a", refresh_token: "r" });
  });
  it("clears a stored session", () => {
    saveSession({ access_token: "a", refresh_token: "r" });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
