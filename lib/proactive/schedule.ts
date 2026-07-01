/** Pure time helpers for proactive scheduling (testable without DB). */

export function parseTimeToMinutes(time: string): number {
  const normalized = time.trim().slice(0, 5);
  const [hourPart, minutePart] = normalized.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

export function getLocalMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function getLocalDateKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isInQuietHours(
  localMinutes: number,
  quietStart: string,
  quietEnd: string,
): boolean {
  const startM = parseTimeToMinutes(quietStart);
  const endM = parseTimeToMinutes(quietEnd);

  if (startM === endM) return false;
  if (startM < endM) {
    return localMinutes >= startM && localMinutes < endM;
  }
  return localMinutes >= startM || localMinutes < endM;
}

/** True when local time is within [briefTime, briefTime + windowMinutes). */
export function isBriefDueNow(
  localMinutes: number,
  briefTime: string,
  windowMinutes = 5,
): boolean {
  const briefM = parseTimeToMinutes(briefTime);
  const endM = briefM + windowMinutes;
  if (endM <= 24 * 60) {
    return localMinutes >= briefM && localMinutes < endM;
  }
  const wrappedEnd = endM % (24 * 60);
  return localMinutes >= briefM || localMinutes < wrappedEnd;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}
