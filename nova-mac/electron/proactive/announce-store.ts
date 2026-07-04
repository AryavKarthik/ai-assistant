import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Which (item, lead) pairs have already been announced — persisted so an app
// restart doesn't re-announce everything that's still inside its lead window.
const STORE_VERSION = 1;
/** Entries older than this are pruned; nothing legitimately re-fires later. */
const RETENTION_MS = 48 * 60 * 60 * 1000;

let cache: Map<string, number> | null = null;

function file(): string {
  return join(app.getPath("userData"), "announced-alerts.json");
}

function load(): Map<string, number> {
  if (cache) return cache;
  cache = new Map();
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), "utf8")) as {
        v?: number;
        entries?: Array<[string, number]>;
      };
      if (raw.v === STORE_VERSION && Array.isArray(raw.entries)) {
        for (const [k, t] of raw.entries) {
          if (typeof k === "string" && typeof t === "number") cache.set(k, t);
        }
      }
    }
  } catch {
    // corrupted store — start fresh
  }
  return cache;
}

function persist(): void {
  try {
    writeFileSync(
      file(),
      JSON.stringify({ v: STORE_VERSION, entries: [...load().entries()] }),
      "utf8",
    );
  } catch {
    // best effort
  }
}

export function wasAnnounced(key: string): boolean {
  return load().has(key);
}

export function markAnnounced(key: string, now = Date.now()): void {
  const map = load();
  map.set(key, now);
  for (const [k, t] of map) {
    if (now - t > RETENTION_MS) map.delete(k);
  }
  persist();
}
