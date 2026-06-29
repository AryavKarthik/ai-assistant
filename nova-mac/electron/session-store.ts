import { app, safeStorage } from "electron";
import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface StoredSession {
  access_token: string;
  refresh_token: string;
}

function file(): string {
  return join(app.getPath("userData"), "session.bin");
}

export function saveSession(tokens: StoredSession): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Keychain encryption unavailable");
  }
  const enc = safeStorage.encryptString(JSON.stringify(tokens));
  writeFileSync(file(), enc.toString("base64"), "utf8");
}

export function loadSession(): StoredSession | null {
  const p = file();
  if (!existsSync(p)) return null;
  try {
    const buf = Buffer.from(readFileSync(p, "utf8"), "base64");
    return JSON.parse(safeStorage.decryptString(buf)) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  const p = file();
  if (existsSync(p)) rmSync(p);
}
