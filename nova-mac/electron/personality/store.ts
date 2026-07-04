import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PersonalityTrait } from "@shared/types";

// Learned personality/style traits: the user's feedback about how Nova should
// talk ("swear less", "call me Ary", "more banter") captured mid-conversation
// via the adjust_personality tool or edited manually in Settings. Injected
// into the cached system-prompt block every turn, so they're permanent until
// removed. Device-local userData JSON.
const STORE_VERSION = 1;
const MAX_TRAITS = 40;

// The data dir is injected from main.ts rather than read off electron's `app`
// here: this module is statically imported by chat-turn, which vitest loads
// in plain Node where the electron package can't resolve. Before init (or in
// tests) the store is empty and writes are no-ops.
let dataDir: string | null = null;

export function initPersonalityStore(dir: string): void {
  dataDir = dir;
  cache = null;
  blockCache = null;
}

let cache: PersonalityTrait[] | null = null;
/** Prompt block memo — rebuilt only when traits change, so the cached
 *  system-prompt prefix stays byte-identical across turns. */
let blockCache: string | null = null;

function file(): string | null {
  return dataDir ? join(dataDir, "personality.json") : null;
}

function load(): PersonalityTrait[] {
  if (cache) return cache;
  cache = [];
  const path = file();
  try {
    if (path && existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        v?: number;
        traits?: unknown[];
      };
      if (raw.v === STORE_VERSION && Array.isArray(raw.traits)) {
        for (const t of raw.traits) {
          const trait = t as Partial<PersonalityTrait>;
          if (typeof trait.id === "string" && typeof trait.text === "string" && trait.text.trim()) {
            cache.push({
              id: trait.id,
              text: trait.text,
              createdAt: trait.createdAt ?? new Date().toISOString(),
              source: trait.source === "manual" ? "manual" : "chat",
            });
          }
        }
      }
    }
  } catch {
    // corrupted store — start fresh
  }
  return cache;
}

function persist(): void {
  blockCache = null;
  const path = file();
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify({ v: STORE_VERSION, traits: load() }, null, 2), "utf8");
  } catch {
    // best effort
  }
}

export function listTraits(): PersonalityTrait[] {
  return load().map((t) => ({ ...t }));
}

export function addTrait(text: string, source: PersonalityTrait["source"]): PersonalityTrait {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("trait text is required");
  const traits = load();
  // Same trait twice (the model repeating itself) just refreshes the original.
  const existing = traits.find((t) => t.text.toLowerCase() === trimmed.toLowerCase());
  if (existing) return { ...existing };
  const trait: PersonalityTrait = {
    id: randomUUID(),
    text: trimmed,
    createdAt: new Date().toISOString(),
    source,
  };
  traits.push(trait);
  // Cap: oldest chat-learned traits fall off first; manual ones stay.
  while (traits.length > MAX_TRAITS) {
    const idx = traits.findIndex((t) => t.source === "chat");
    traits.splice(idx === -1 ? 0 : idx, 1);
  }
  persist();
  return { ...trait };
}

export function updateTrait(id: string, text: string): boolean {
  const trait = load().find((t) => t.id === id);
  if (!trait || !text.trim()) return false;
  trait.text = text.trim();
  persist();
  return true;
}

export function removeTrait(id: string): boolean {
  const traits = load();
  const idx = traits.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  traits.splice(idx, 1);
  persist();
  return true;
}

/** Best-effort removal by fuzzy text match (for the adjust_personality tool's
 *  remove action, where the model quotes the trait rather than an id). */
export function removeTraitByText(text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return false;
  const traits = load();
  const idx = traits.findIndex(
    (t) => t.text.toLowerCase() === needle || t.text.toLowerCase().includes(needle),
  );
  if (idx === -1) return false;
  traits.splice(idx, 1);
  persist();
  return true;
}

/** System-prompt block appended to the static (cached) prompt. Empty string
 *  when no traits exist so the prompt is unchanged for fresh installs. */
export function getPersonalityBlock(): string {
  if (blockCache !== null) return blockCache;
  const traits = load();
  blockCache =
    traits.length === 0
      ? ""
      : `\n\nLearned style (from the user's own feedback — these are standing orders, follow them over any default style):\n${traits
          .map((t) => `- ${t.text}`)
          .join("\n")}`;
  return blockCache;
}
