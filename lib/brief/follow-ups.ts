import { listCalendarEvents } from "@/lib/google/calendar";
import { getGoogleConnectionStatus } from "@/lib/db/google-tokens";
import {
  createProactiveNotification,
  hasFollowUpForEvent,
} from "@/lib/db/proactive-notifications";
import { sendProactivePush } from "@/lib/proactive/push";
import type { UserPreferences } from "@/lib/proactive/types";
import { getLocalDateKey } from "@/lib/proactive/schedule";
import { isProactiveQuietNow } from "@/lib/brief/should-send";

export interface FollowUpDispatchResult {
  sent: number;
}

function parseEventTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function dispatchFollowUpsIfDue(
  prefs: UserPreferences,
  now = new Date(),
): Promise<FollowUpDispatchResult> {
  if (prefs.proactive_tier !== "full") return { sent: 0 };
  if (isProactiveQuietNow(prefs, now)) return { sent: 0 };

  const connections = await getGoogleConnectionStatus(prefs.user_id);
  if (!connections.calendar.connected) return { sent: 0 };

  const timeZone = prefs.timezone || "UTC";
  const localDate = getLocalDateKey(now, timeZone);

  const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const result = await listCalendarEvents(prefs.user_id, {
    timeMin: windowStart.toISOString(),
    timeMax: now.toISOString(),
    maxResults: 10,
  });

  if ("error" in result) return { sent: 0 };

  let sent = 0;

  for (const event of result.events) {
    const end = parseEventTime(event.end);
    if (!end) continue;

    const msSinceEnd = now.getTime() - end.getTime();
    if (msSinceEnd < 5 * 60 * 1000 || msSinceEnd > 60 * 60 * 1000) {
      continue;
    }

    const dup = await hasFollowUpForEvent(
      prefs.user_id,
      event.id,
      localDate,
    );
    if (dup) continue;

    const suggestedPrompt = `I just finished "${event.summary}". Help me write a short summary note of what was discussed and any action items.`;

    const notification = await createProactiveNotification({
      userId: prefs.user_id,
      type: "follow_up",
      title: "Meeting follow-up",
      body: `Want a summary note for "${event.summary}"?`,
      payload: {
        calendar_event_id: event.id,
        local_date: localDate,
        suggested_prompt: suggestedPrompt,
        event_summary: event.summary,
      },
    });

    if (prefs.push_proactive_enabled) {
      await sendProactivePush(prefs.user_id, {
        title: "Follow-up suggestion",
        body: `Summary note for "${event.summary}"?`,
        url: `/?prompt=${encodeURIComponent(suggestedPrompt)}`,
        type: "follow_up",
        notificationId: notification.id,
      });
    }

    console.info("[proactive] follow_up_sent", {
      userId: prefs.user_id,
      eventId: event.id,
    });

    sent++;
    if (sent >= 2) break;
  }

  return { sent };
}
