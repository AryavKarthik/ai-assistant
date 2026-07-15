import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomSkill, SkillAction } from "@shared/types";
import { openApp, openPath, openUrl, runShortcut } from "./mac-control";

const STORE_VERSION = 1;

export interface SkillRunResult {
  skill_id: string;
  skill_name: string;
  matched_trigger?: string;
  actions_run: number;
  failures: Array<{ index: number; action: SkillAction; error: string }>;
}

let dataDir: string | null = null;
let cache: CustomSkill[] | null = null;

export function initSkillsStore(dir: string): void {
  dataDir = dir;
  cache = null;
}

function file(): string | null {
  return dataDir ? join(dataDir, "custom-skills.json") : null;
}

function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

function parseAction(raw: unknown): SkillAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as Record<string, unknown>;
  if (action.type === "open_path" && typeof action.path === "string" && action.path.trim()) {
    return { type: "open_path", path: action.path.trim() };
  }
  if (action.type === "open_app" && typeof action.app_name === "string" && action.app_name.trim()) {
    return { type: "open_app", app_name: action.app_name.trim() };
  }
  if (action.type === "open_url" && typeof action.url === "string" && action.url.trim()) {
    return { type: "open_url", url: action.url.trim() };
  }
  if (action.type === "run_shortcut" && typeof action.name === "string" && action.name.trim()) {
    return {
      type: "run_shortcut",
      name: action.name.trim(),
      input: typeof action.input === "string" ? action.input : undefined,
    };
  }
  return null;
}

function load(): CustomSkill[] {
  if (cache) return cache;
  cache = [];
  const path = file();
  try {
    if (path && existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { v?: number; skills?: unknown[] };
      if (raw.v === STORE_VERSION && Array.isArray(raw.skills)) {
        for (const skillRaw of raw.skills) {
          if (!skillRaw || typeof skillRaw !== "object") continue;
          const skill = skillRaw as Record<string, unknown>;
          if (typeof skill.id !== "string" || typeof skill.name !== "string") continue;
          const triggers = Array.isArray(skill.triggers)
            ? skill.triggers
                .filter((t): t is string => typeof t === "string")
                .map((t) => normalizePhrase(t))
                .filter(Boolean)
            : [];
          const actions = Array.isArray(skill.actions)
            ? skill.actions.map(parseAction).filter((a): a is SkillAction => Boolean(a))
            : [];
          if (!triggers.length || !actions.length) continue;
          cache.push({
            id: skill.id,
            name: skill.name.trim() || "Untitled skill",
            triggers,
            actions,
            enabled: skill.enabled !== false,
            createdAt:
              typeof skill.createdAt === "string" ? skill.createdAt : new Date().toISOString(),
            updatedAt:
              typeof skill.updatedAt === "string" ? skill.updatedAt : new Date().toISOString(),
          });
        }
      }
    }
  } catch {
    // corrupted store: ignore and start fresh
  }
  return cache;
}

function persist(): void {
  const path = file();
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify({ v: STORE_VERSION, skills: load() }, null, 2), "utf8");
  } catch {
    // best effort
  }
}

export function listSkills(): CustomSkill[] {
  return load().map((s) => ({ ...s, triggers: [...s.triggers], actions: [...s.actions] }));
}

export function createSkill(input: {
  name: string;
  triggers: string[];
  actions: unknown[];
  enabled?: boolean;
}): CustomSkill {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  const triggers = (input.triggers ?? []).map(normalizePhrase).filter(Boolean);
  if (triggers.length === 0) throw new Error("at least one trigger is required");
  const actions = (input.actions ?? []).map(parseAction).filter((a): a is SkillAction => Boolean(a));
  if (actions.length === 0) throw new Error("at least one valid action is required");
  const now = new Date().toISOString();
  const skill: CustomSkill = {
    id: randomUUID(),
    name,
    triggers: Array.from(new Set(triggers)),
    actions,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
  load().push(skill);
  persist();
  return { ...skill, triggers: [...skill.triggers], actions: [...skill.actions] };
}

export function updateSkill(
  id: string,
  patch: { name?: string; triggers?: string[]; actions?: unknown[]; enabled?: boolean },
): CustomSkill | null {
  const skill = load().find((s) => s.id === id);
  if (!skill) return null;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("name cannot be empty");
    skill.name = name;
  }
  if (patch.triggers !== undefined) {
    const triggers = patch.triggers.map(normalizePhrase).filter(Boolean);
    if (triggers.length === 0) throw new Error("at least one trigger is required");
    skill.triggers = Array.from(new Set(triggers));
  }
  if (patch.actions !== undefined) {
    const actions = patch.actions.map(parseAction).filter((a): a is SkillAction => Boolean(a));
    if (actions.length === 0) throw new Error("at least one valid action is required");
    skill.actions = actions;
  }
  if (patch.enabled !== undefined) skill.enabled = patch.enabled;
  skill.updatedAt = new Date().toISOString();
  persist();
  return { ...skill, triggers: [...skill.triggers], actions: [...skill.actions] };
}

export function deleteSkill(id: string): boolean {
  const skills = load();
  const idx = skills.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  skills.splice(idx, 1);
  persist();
  return true;
}

async function runAction(action: SkillAction): Promise<void> {
  switch (action.type) {
    case "open_path":
      if (!action.path.startsWith("/")) throw new Error("open_path requires an absolute path");
      await openPath(action.path);
      return;
    case "open_app":
      await openApp(action.app_name);
      return;
    case "open_url":
      await openUrl(action.url);
      return;
    case "run_shortcut":
      await runShortcut(action.name, action.input);
      return;
  }
}

export async function runSkill(id: string): Promise<SkillRunResult | null> {
  const skill = load().find((s) => s.id === id && s.enabled);
  if (!skill) return null;
  const failures: SkillRunResult["failures"] = [];
  for (let i = 0; i < skill.actions.length; i++) {
    const action = skill.actions[i];
    try {
      await runAction(action);
    } catch (err) {
      failures.push({
        index: i,
        action,
        error: err instanceof Error ? err.message : "Action failed",
      });
    }
  }
  return {
    skill_id: skill.id,
    skill_name: skill.name,
    actions_run: skill.actions.length,
    failures,
  };
}

export async function runSkillByTrigger(transcript: string): Promise<SkillRunResult | null> {
  const normalized = normalizePhrase(transcript);
  if (!normalized) return null;
  const skill = load().find(
    (s) =>
      s.enabled &&
      s.triggers.some((t) => normalized === t || normalized.startsWith(`${t} `)),
  );
  if (!skill) return null;
  const result = await runSkill(skill.id);
  if (!result) return null;
  const matched = skill.triggers.find((t) => normalized === t || normalized.startsWith(`${t} `));
  return { ...result, matched_trigger: matched };
}
