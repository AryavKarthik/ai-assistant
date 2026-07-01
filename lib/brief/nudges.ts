import {
  listCalendarEvents,
  type CalendarEventSummary,
} from "@/lib/google/calendar";
import { getGoogleConnectionStatus } from "@/lib/db/google-tokens";
import {
  createProactiveNotification,
  countNudgesSentToday,
  hasRecentNotification,
} from "@/lib/db/proactive-notifications";
import { listUpcomingReminders, getReminderDueLabel } from "@/lib/db/reminders";
import { sendProactivePush } from "@/lib/proactive/push";
import type { UserPreferences } from "@/lib/proactive/types";
import { MAX_NUDGES_PER_USER_PER_DAY } from "@/lib/proactive/types";
import { getLocalDateKey } from "@/lib/proactive/schedule";
import { isProactiveQuietNow } from "@/lib/brief/should-send";

export interface NudgeDispatchResult {
  sent: number;
}

function parseEventTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventsOverlap(a: CalendarEventSummary, b: CalendarEventSummary): boolean {
  const aStart = parseEventTime(a.start);
  const aEnd = parseEventTime(a.end) ?? aStart;
  const bStart = parseEventTime(b.start);
  const bEnd = parseEventTime(b.end) ?? bStart;
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  if (a.id === b.id) return false;
  return aStart < bEnd && bStart < aEnd;
}

export async function dispatchNudgesIfDue(
  prefs: UserPreferences,
  now = new Date(),
): Promise<NudgeDispatchResult> {
  if (prefs.proactive_tier !== "full") return { sent: 0 };
  if (isProactiveQuietNow(prefs, now)) return { sent: 0 };

  const timeZone = prefs.timezone || "UTC";
  const localDate = getLocalDateKey(now, timeZone);
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  const alreadySent = await countNudgesSentToday(
    prefs.user_id,
    dayStart.toISOString(),
  );
  if (alreadySent >= MAX_NUDGES_PER_USER_PER_DAY) {
    return { sent: 0 };
  }

  let sent = 0;
  const cap = MAX_NUDGES_PER_USER_PER_DAY - alreadySent;

  const reminders = await listUpcomingReminders(prefs.user_id, 20);
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  for (const reminder of reminders) {
    if (sent >= cap) break;
    if (!reminder.due_at) continue;

    const due = new Date(reminder.due_at);
    const label = getReminderDueLabel(reminder.due_at);
    const msUntilDue = due.getTime() - now.getTime();

    if (label === "overdue" && now.getTime() - due.getTime() > 60 * 60 * 1000) {
      const dup = await hasRecentNotification(
        prefs.user_id,
        "overdue_nudge",
        "reminder_id",
        reminder.id,
        oneDayAgo,
      );
      if (dup) continue;

      const notification = await createProactiveNotification({
        userId: prefs.user_id,
        type: "overdue_nudge",
        title: "Overdue reminder",
        body: `${reminder.title} is overdue.`,
        payload: { reminder_id: reminder.id },
      });

      if (prefs.push_proactive_enabled) {
        await sendProactivePush(prefs.user_id, {
          title: "Heads up — overdue",
          body: reminder.title,
          url: "/reminders",
          type: "overdue_nudge",
          notificationId: notification.id,
        });
      }
      sent++;
      continue;
    }

    if (msUntilDue > 0 && msUntilDue <= 24 * 60 * 60 * 1000) {
      const dup = await hasRecentNotification(
        prefs.user_id,
        "deadline_nudge",
        "reminder_id",
        reminder.id,
        twelveHoursAgo,
      );
      if (dup) continue;

      const hours = Math.max(1, Math.round(msUntilDue / (60 * 60 * 1000)));
      const notification = await createProactiveNotification({
        userId: prefs.user_id,
        type: "deadline_nudge",
        title: "Deadline approaching",
        body: `${reminder.title} — due in about ${hours}h.`,
        payload: { reminder_id: reminder.id },
      });

      if (prefs.push_proactive_enabled) {
        await sendProactivePush(prefs.user_id, {
          title: "Heads up — deadline",
          body: `${reminder.title} — due in ~${hours}h`,
          url: "/reminders",
          type: "deadline_nudge",
          notificationId: notification.id,
        });
      }
      sent++;
    }
  }

  if (sent >= cap) return { sent };

  const connections = await getGoogleConnectionStatus(prefs.user_id);
  if (!connections.calendar.connected) return { sent };

  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const result = await listCalendarEvents(prefs.user_id, {
    timeMin: now.toISOString(),
    timeMax: windowEnd.toISOString(),
    maxResults: 15,
  });

  if ("error" in result) return { sent };

  for (let i = 0; i < result.events.length && sent < cap; i++) {
    for (let j = i + 1; j < result.events.length && sent < cap; j++) {
      const a = result.events[i];
      const b = result.events[j];
      if (!eventsOverlap(a, b)) continue;

      const pairKey = [a.id, b.id].sort().join(":");
      const dup = await hasRecentNotification(
        prefs.user_id,
        "conflict_nudge",
        "conflict_pair",
        pairKey,
        oneDayAgo,
      );
      if (dup) continue;

      const notification = await createProactiveNotification({
        userId: prefs.user_id,
        type: "conflict_nudge",
        title: "Calendar conflict",
        body: `"${a.summary}" overlaps with "${b.summary}".`,
        payload: {
          conflict_pair: pairKey,
          event_a_id: a.id,
          event_b_id: b.id,
        },
      });

      if (prefs.push_proactive_enabled) {
        await sendProactivePush(prefs.user_id, {
          title: "Calendar conflict",
          body: `${a.summary} overlaps with ${b.summary}`,
          url: "/",
          type: "conflict_nudge",
          notificationId: notification.id,
        });
      }
      sent++;
    }
  }

  return { sent };
}
