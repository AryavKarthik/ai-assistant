/**
 * Tests proactive schedule helpers (run: npm run test:brief-schedule).
 */
import assert from "node:assert/strict";
import {
  getLocalDateKey,
  getLocalMinutes,
  isBriefDueNow,
  isInQuietHours,
  parseTimeToMinutes,
} from "../lib/proactive/schedule.ts";

const zone = "Australia/Sydney";
const morning = new Date("2026-06-25T22:00:00.000Z"); // ~8:00 AEST

assert.equal(parseTimeToMinutes("07:00"), 7 * 60);
assert.equal(parseTimeToMinutes("07:00:00"), 7 * 60);

const localMinutes = getLocalMinutes(morning, zone);
assert.ok(isBriefDueNow(localMinutes, "08:00", 5));
assert.ok(!isBriefDueNow(localMinutes, "10:00", 5));

assert.ok(isInQuietHours(23 * 60, "22:00", "08:00"));
assert.ok(!isInQuietHours(12 * 60, "22:00", "08:00"));

const dateKey = getLocalDateKey(morning, zone);
assert.match(dateKey, /^\d{4}-\d{2}-\d{2}$/);

function shouldSendBrief(prefs, now) {
  if (!prefs.brief_enabled || prefs.proactive_tier !== "full") return false;
  const tz = prefs.timezone || "UTC";
  const minutes = getLocalMinutes(now, tz);
  const localDate = getLocalDateKey(now, tz);
  if (isInQuietHours(minutes, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
    return false;
  }
  if (!isBriefDueNow(minutes, prefs.brief_time_local)) return false;
  if (prefs.last_brief_local_date === localDate) return false;
  return true;
}

const prefs = {
  proactive_tier: "full",
  brief_enabled: true,
  brief_time_local: "08:00:00",
  timezone: zone,
  quiet_hours_start: "22:00:00",
  quiet_hours_end: "08:00:00",
  last_brief_local_date: null,
};

assert.ok(shouldSendBrief(prefs, morning));
assert.ok(
  !shouldSendBrief({ ...prefs, last_brief_local_date: dateKey }, morning),
);

console.log("schedule + brief eligibility tests passed");
