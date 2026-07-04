import { app } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentLoop, LoopSchedule, LoopUpsertRequest } from "@shared/types";
import { computeNextRun } from "./schedule";

// Agent loops are device-local (they run on this Mac, drive Mac tools, and
// speak through this orb), so they live in a userData JSON file.
const STORE_VERSION = 1;

let cache: AgentLoop[] | null = null;

function file(): string {
  return join(app.getPath("userData"), "agent-loops.json");
}

function isValidSchedule(s: unknown): s is LoopSchedule {
  if (!s || typeof s !== "object") return false;
  const sc = s as Record<string, unknown>;
  if (sc.kind === "once") return typeof sc.at === "string";
  if (sc.kind === "daily") return typeof sc.timeLocal === "string";
  if (sc.kind === "interval") return typeof sc.everyMinutes === "number";
  return false;
}

function load(): AgentLoop[] {
  if (cache) return cache;
  cache = [];
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), "utf8")) as {
        v?: number;
        loops?: unknown[];
      };
      if (raw.v === STORE_VERSION && Array.isArray(raw.loops)) {
        for (const l of raw.loops) {
          const loop = l as Partial<AgentLoop>;
          if (
            typeof loop.id === "string" &&
            typeof loop.instruction === "string" &&
            isValidSchedule(loop.schedule)
          ) {
            cache.push({
              id: loop.id,
              name: typeof loop.name === "string" && loop.name ? loop.name : "Untitled loop",
              instruction: loop.instruction,
              schedule: loop.schedule,
              enabled: loop.enabled !== false,
              speakResult: loop.speakResult !== false,
              createdAt: loop.createdAt ?? new Date().toISOString(),
              lastRunAt: loop.lastRunAt ?? null,
              lastResult: loop.lastResult ?? null,
              nextRunAt: loop.nextRunAt ?? null,
            });
          }
        }
      }
    }
  } catch {
    // corrupted store — start fresh rather than crash the scheduler
  }
  return cache;
}

function persist(): void {
  try {
    writeFileSync(file(), JSON.stringify({ v: STORE_VERSION, loops: load() }, null, 2), "utf8");
  } catch {
    // best effort
  }
}

export function listLoops(): AgentLoop[] {
  return load().map((l) => ({ ...l }));
}

export function getLoop(id: string): AgentLoop | null {
  const found = load().find((l) => l.id === id);
  return found ? { ...found } : null;
}

export function upsertLoop(req: LoopUpsertRequest): AgentLoop {
  if (!req.instruction?.trim()) throw new Error("instruction is required");
  if (!isValidSchedule(req.schedule)) throw new Error("invalid schedule");
  const loops = load();
  const now = Date.now();
  const nextRun = computeNextRun(req.schedule, now);
  const existing = req.id ? loops.find((l) => l.id === req.id) : undefined;

  if (existing) {
    existing.name = req.name?.trim() || existing.name;
    existing.instruction = req.instruction.trim();
    existing.schedule = req.schedule;
    existing.enabled = req.enabled;
    existing.speakResult = req.speakResult;
    existing.nextRunAt = nextRun ? new Date(nextRun).toISOString() : null;
    persist();
    return { ...existing };
  }

  const loop: AgentLoop = {
    id: randomUUID(),
    name: req.name?.trim() || "Untitled loop",
    instruction: req.instruction.trim(),
    schedule: req.schedule,
    enabled: req.enabled,
    speakResult: req.speakResult,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    lastResult: null,
    nextRunAt: nextRun ? new Date(nextRun).toISOString() : null,
  };
  loops.push(loop);
  persist();
  return { ...loop };
}

export function deleteLoop(id: string): boolean {
  const loops = load();
  const idx = loops.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  loops.splice(idx, 1);
  persist();
  return true;
}

/** Records a run's outcome and advances the schedule: "once" loops disable
 *  themselves after running; daily/interval compute their next slot. */
export function markLoopRan(id: string, result: string, ranAtMs = Date.now()): void {
  const loop = load().find((l) => l.id === id);
  if (!loop) return;
  loop.lastRunAt = new Date(ranAtMs).toISOString();
  loop.lastResult = result.slice(0, 500);
  if (loop.schedule.kind === "once") {
    loop.enabled = false;
    loop.nextRunAt = null;
  } else {
    // Advance from just after the run so an interval doesn't immediately re-fire.
    const next = computeNextRun(loop.schedule, ranAtMs + 1000);
    loop.nextRunAt = next ? new Date(next).toISOString() : null;
  }
  persist();
}

/** Loops whose nextRunAt is due at `nowMs`. Stale-once protection: a due time
 *  more than `staleMs` in the past is skipped (marked, not run) so a loop
 *  scheduled while the Mac was asleep for hours doesn't fire absurdly late. */
export function dueLoops(nowMs = Date.now(), staleMs = 30 * 60_000): {
  run: AgentLoop[];
  stale: AgentLoop[];
} {
  const run: AgentLoop[] = [];
  const stale: AgentLoop[] = [];
  for (const loop of load()) {
    if (!loop.enabled || !loop.nextRunAt) continue;
    const at = Date.parse(loop.nextRunAt);
    if (Number.isNaN(at) || at > nowMs) continue;
    if (nowMs - at > staleMs) stale.push({ ...loop });
    else run.push({ ...loop });
  }
  return { run, stale };
}
