import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ALERT_PREFS, type AlertPrefs } from "@shared/types";

// Device-local announcement settings (spoken pre-alerts only matter on this
// Mac), so they live in a userData JSON file rather than Supabase.
const STORE_VERSION = 1;

function file(): string {
  return join(app.getPath("userData"), "alert-prefs.json");
}

function sanitizeLeads(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 24 * 60)
    .map((v) => Math.round(v));
  // Dedupe, largest lead first so announcements fire in natural order.
  return [...new Set(cleaned)].sort((a, b) => b - a);
}

export function getAlertPrefs(): AlertPrefs {
  const defaults = DEFAULT_ALERT_PREFS;
  try {
    if (!existsSync(file())) return { ...defaults };
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<AlertPrefs & { v: number }>;
    if (raw.v !== STORE_VERSION) return { ...defaults };
    return {
      voiceAnnouncementsEnabled:
        typeof raw.voiceAnnouncementsEnabled === "boolean"
          ? raw.voiceAnnouncementsEnabled
          : defaults.voiceAnnouncementsEnabled,
      reminderLeadMinutes: sanitizeLeads(raw.reminderLeadMinutes, defaults.reminderLeadMinutes),
      calendarLeadMinutes: sanitizeLeads(raw.calendarLeadMinutes, defaults.calendarLeadMinutes),
      speakTimerDone:
        typeof raw.speakTimerDone === "boolean" ? raw.speakTimerDone : defaults.speakTimerDone,
      quietHoursEnabled:
        typeof raw.quietHoursEnabled === "boolean"
          ? raw.quietHoursEnabled
          : defaults.quietHoursEnabled,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveAlertPrefs(patch: Partial<AlertPrefs>): AlertPrefs {
  const merged = { ...getAlertPrefs(), ...patch };
  merged.reminderLeadMinutes = sanitizeLeads(
    merged.reminderLeadMinutes,
    DEFAULT_ALERT_PREFS.reminderLeadMinutes,
  );
  merged.calendarLeadMinutes = sanitizeLeads(
    merged.calendarLeadMinutes,
    DEFAULT_ALERT_PREFS.calendarLeadMinutes,
  );
  try {
    writeFileSync(file(), JSON.stringify({ v: STORE_VERSION, ...merged }), "utf8");
  } catch {
    // Best effort — settings falling back to defaults isn't worth crashing over.
  }
  return merged;
}
