const STORAGE_KEY = "assistant.client-timezone";

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Browser IANA timezone (e.g. Australia/Sydney). */
export function getClientTimeZone(): string {
  if (typeof window === "undefined") return "UTC";
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) {
      return zone;
    }
  } catch {
    // fall through
  }
  return "UTC";
}

export function rememberClientTimeZone(): string {
  const zone = getClientTimeZone();
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, zone);
    } catch {
      // ignore
    }
  }
  return zone;
}

export function formatClientClock(now = new Date()): {
  time: string;
  date: string;
  zone: string;
  zoneLabel: string;
} {
  const zone = getClientTimeZone();
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(now);
  const zoneLabel =
    parts.find((part) => part.type === "timeZoneName")?.value ?? zone;

  return { time, date, zone, zoneLabel };
}
