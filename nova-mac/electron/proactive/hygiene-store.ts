import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Tracks the last time the memory-hygiene pass (dedupe + embedding backfill)
// ran, so the 30s proactive tick only triggers it once a day instead of on
// every tick. Nova has no cron infra of its own — the shared web app's weekly
// cron already covers hygiene for the same underlying Supabase table, but a
// user who only ever runs Nova (never deploys/uses the web app) would
// otherwise get no automatic cleanup at all.
const FILE_NAME = "memory-hygiene.json";
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function file(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

export function shouldRunHygiene(now = Date.now()): boolean {
  try {
    if (!existsSync(file())) return true;
    const raw = JSON.parse(readFileSync(file(), "utf8")) as { lastRunAt?: number };
    if (typeof raw.lastRunAt !== "number") return true;
    return now - raw.lastRunAt >= MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markHygieneRan(now = Date.now()): void {
  try {
    writeFileSync(file(), JSON.stringify({ lastRunAt: now }), "utf8");
  } catch {
    // best effort
  }
}
