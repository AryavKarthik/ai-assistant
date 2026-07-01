import { createServerClient } from "@/lib/supabase/server";
import { extractSubjectKey } from "@/lib/memory/reconcile";

export interface RuntimeClockContext {
  iso: string;
  localDate: string;
  localTime: string;
  timezone: string;
  timezoneLabel: string;
}

const TIMEZONE_KEYWORDS = [
  "timezone",
  "time zone",
  "aedt",
  "aest",
  "australian",
  "australia",
  "sydney",
  "melbourne",
  "brisbane",
  "perth",
  "adelaide",
];

const CITY_TO_IANA: Array<{ pattern: RegExp; zone: string }> = [
  { pattern: /\bperth\b/i, zone: "Australia/Perth" },
  { pattern: /\badelaide\b/i, zone: "Australia/Adelaide" },
  { pattern: /\bbrisbane\b/i, zone: "Australia/Brisbane" },
  { pattern: /\bmelbourne\b/i, zone: "Australia/Melbourne" },
  { pattern: /\bsydney\b/i, zone: "Australia/Sydney" },
  {
    pattern: /\b(?:australian|australia|aedt|aest)\b/i,
    zone: "Australia/Sydney",
  },
];

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function resolveTimezoneFromText(text: string): string | null {
  const normalized = text.toLowerCase();

  const ianaMatch = text.match(
    /\b(?:timezone|time zone)(?:\s+is)?\s+([A-Za-z_]+\/[A-Za-z_]+)\b/i,
  );
  if (ianaMatch?.[1] && isValidTimeZone(ianaMatch[1])) {
    return ianaMatch[1];
  }

  for (const { pattern, zone } of CITY_TO_IANA) {
    if (pattern.test(normalized)) return zone;
  }

  if (extractSubjectKey(text) === "timezone") {
    for (const { pattern, zone } of CITY_TO_IANA) {
      if (pattern.test(normalized)) return zone;
    }
    if (/\b(?:australian|australia|aedt|aest)\b/i.test(normalized)) {
      return "Australia/Sydney";
    }
  }

  return null;
}

async function fetchTimezoneMemoryHints(userId: string): Promise<string[]> {
  const supabase = createServerClient();
  const orFilter = TIMEZONE_KEYWORDS.map(
    (keyword) => `content.ilike.%${keyword}%`,
  ).join(",");

  const { data, error } = await supabase
    .from("memories")
    .select("content, created_at")
    .eq("user_id", userId)
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data ?? []).map((row) => row.content);
}

export async function resolveUserTimezone(userId: string): Promise<string> {
  const hints = await fetchTimezoneMemoryHints(userId);

  for (const hint of hints) {
    const zone = resolveTimezoneFromText(hint);
    if (zone) return zone;
  }

  return "UTC";
}

const timezoneCache = new Map<string, { zone: string; at: number }>();
const TIMEZONE_CACHE_TTL_MS = 10 * 60 * 1000;

export async function resolveUserTimezoneCached(
  userId: string,
): Promise<string> {
  const cached = timezoneCache.get(userId);
  if (cached && Date.now() - cached.at < TIMEZONE_CACHE_TTL_MS) {
    return cached.zone;
  }
  const zone = await resolveUserTimezone(userId);
  timezoneCache.set(userId, { zone, at: Date.now() });
  return zone;
}

function formatTimezoneLabel(timeZone: string, date: Date): string {
  if (timeZone === "UTC") return "UTC";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);

  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

export function buildClockForZone(timeZone: string, date = new Date()): RuntimeClockContext {
  const localDate = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);

  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  return {
    iso: date.toISOString(),
    localDate,
    localTime,
    timezone: timeZone,
    timezoneLabel: formatTimezoneLabel(timeZone, date),
  };
}

export async function buildRuntimeClockContext(
  userId: string,
  now = new Date(),
  clientTimeZone?: string | null,
): Promise<RuntimeClockContext> {
  let timeZone = await resolveUserTimezoneCached(userId);
  if (timeZone === "UTC" && clientTimeZone && isValidTimeZone(clientTimeZone)) {
    timeZone = clientTimeZone;
  }
  return buildClockForZone(timeZone, now);
}

export function formatRuntimeClockForPrompt(clock: RuntimeClockContext): string {
  const zoneDetail =
    clock.timezone === "UTC"
      ? "UTC (user timezone unknown)"
      : `${clock.timezone}, ${clock.timezoneLabel}`;

  return `<runtime_context>
- Now: ${clock.localDate}, ${clock.localTime} (${zoneDetail})
- ISO: ${clock.iso}
</runtime_context>`;
}

export function formatTodayCalendarLine(clock: RuntimeClockContext): string {
  const zoneDetail =
    clock.timezone === "UTC"
      ? "UTC"
      : `${clock.timezoneLabel}`;
  return `- [today] ${clock.localDate} (${zoneDetail})`;
}
