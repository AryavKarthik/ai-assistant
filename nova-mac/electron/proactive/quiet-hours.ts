/** Pure quiet-hours (do-not-disturb) math, tested in isolation. */

/** Parses "HH:MM" to minutes past midnight; null when malformed. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * True when `minutesOfDay` falls inside [start, end). Handles windows that
 * wrap midnight (22:00–08:00). An equal start/end means "never quiet" — a
 * 24h DND would just be the master announcements toggle.
 */
export function isWithinQuietHours(
  minutesOfDay: number,
  startHHMM: string,
  endHHMM: string,
): boolean {
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  if (start === null || end === null || start === end) return false;
  if (start < end) return minutesOfDay >= start && minutesOfDay < end;
  // Wraps midnight: quiet when after start OR before end.
  return minutesOfDay >= start || minutesOfDay < end;
}

/** Convenience: quiet-hours check for a concrete Date in machine-local time. */
export function isQuietNow(now: Date, startHHMM: string, endHHMM: string): boolean {
  return isWithinQuietHours(now.getHours() * 60 + now.getMinutes(), startHHMM, endHHMM);
}
