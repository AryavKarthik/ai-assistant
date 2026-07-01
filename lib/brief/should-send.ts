import type { UserPreferences } from "@/lib/proactive/types";
import { buildClockForZone } from "@/lib/chat/runtime-context";
import {
  getLocalDateKey,
  getLocalMinutes,
  isBriefDueNow,
  isInQuietHours,
} from "@/lib/proactive/schedule";

export interface BriefEligibilityInput {
  prefs: UserPreferences;
  now: Date;
}

export function shouldSendDailyBrief(input: BriefEligibilityInput): boolean {
  const { prefs, now } = input;

  if (!prefs.brief_enabled) return false;
  if (prefs.proactive_tier !== "full") return false;

  const timeZone = prefs.timezone || "UTC";
  const localMinutes = getLocalMinutes(now, timeZone);
  const localDate = getLocalDateKey(now, timeZone);

  if (
    isInQuietHours(
      localMinutes,
      prefs.quiet_hours_start,
      prefs.quiet_hours_end,
    )
  ) {
    return false;
  }

  if (!isBriefDueNow(localMinutes, prefs.brief_time_local)) {
    return false;
  }

  if (prefs.last_brief_local_date === localDate) {
    return false;
  }

  return true;
}

export function isProactiveQuietNow(
  prefs: UserPreferences,
  now: Date,
): boolean {
  const timeZone = prefs.timezone || "UTC";
  const localMinutes = getLocalMinutes(now, timeZone);
  return isInQuietHours(
    localMinutes,
    prefs.quiet_hours_start,
    prefs.quiet_hours_end,
  );
}

export function buildClockFromPrefs(
  prefs: UserPreferences,
  now: Date,
): ReturnType<typeof buildClockForZone> {
  return buildClockForZone(prefs.timezone || "UTC", now);
}
