import { getCalendarClient } from "@/lib/google/client";
import { CALENDAR_NOT_CONNECTED } from "@/lib/google/errors";
import {
  formatTodayCalendarLine,
  type RuntimeClockContext,
} from "@/lib/chat/runtime-context";

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

function formatEventTime(
  value: { dateTime?: string | null; date?: string | null } | null | undefined,
): string {
  return value?.dateTime ?? value?.date ?? "";
}

function mapEvent(event: {
  id?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  location?: string | null;
  description?: string | null;
}): CalendarEventSummary | null {
  if (!event.id) return null;
  return {
    id: event.id,
    summary: event.summary ?? "(no title)",
    start: formatEventTime(event.start),
    end: formatEventTime(event.end),
    ...(event.location ? { location: event.location } : {}),
    ...(event.description ? { description: event.description } : {}),
  };
}

export async function listCalendarEvents(
  userId: string,
  options: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  } = {},
): Promise<{ events: CalendarEventSummary[] } | { error: string }> {
  const calendar = await getCalendarClient(userId);
  if (!calendar) return { error: CALENDAR_NOT_CONNECTED };

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: options.timeMin ?? now.toISOString(),
    timeMax: options.timeMax ?? weekAhead.toISOString(),
    maxResults: Math.min(options.maxResults ?? 10, 50),
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = (data.items ?? [])
    .map(mapEvent)
    .filter((e): e is CalendarEventSummary => e !== null);

  return { events };
}

export async function createCalendarEvent(
  userId: string,
  input: {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
  },
): Promise<{ event: CalendarEventSummary } | { error: string }> {
  const calendar = await getCalendarClient(userId);
  if (!calendar) return { error: CALENDAR_NOT_CONNECTED };

  const isAllDay = !input.start.includes("T");

  const { data } = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: isAllDay
        ? { date: input.start.slice(0, 10) }
        : { dateTime: input.start },
      end: isAllDay
        ? { date: input.end.slice(0, 10) }
        : { dateTime: input.end },
      attendees: input.attendees?.map((email) => ({ email })),
    },
  });

  const event = mapEvent(data);
  if (!event) return { error: "Failed to create calendar event" };
  return { event };
}

export async function updateCalendarEvent(
  userId: string,
  input: {
    event_id: string;
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
  },
): Promise<{ event: CalendarEventSummary } | { error: string }> {
  const calendar = await getCalendarClient(userId);
  if (!calendar) return { error: CALENDAR_NOT_CONNECTED };

  const requestBody: Record<string, unknown> = {};
  if (input.summary !== undefined) requestBody.summary = input.summary;
  if (input.description !== undefined) requestBody.description = input.description;
  if (input.location !== undefined) requestBody.location = input.location;
  if (input.start) {
    requestBody.start = input.start.includes("T")
      ? { dateTime: input.start }
      : { date: input.start.slice(0, 10) };
  }
  if (input.end) {
    requestBody.end = input.end.includes("T")
      ? { dateTime: input.end }
      : { date: input.end.slice(0, 10) };
  }

  const { data } = await calendar.events.patch({
    calendarId: "primary",
    eventId: input.event_id,
    requestBody,
  });

  const event = mapEvent(data);
  if (!event) return { error: "Failed to update calendar event" };
  return { event };
}

export async function deleteCalendarEvent(
  userId: string,
  eventId: string,
): Promise<{ success: true } | { error: string }> {
  const calendar = await getCalendarClient(userId);
  if (!calendar) return { error: CALENDAR_NOT_CONNECTED };

  await calendar.events.delete({
    calendarId: "primary",
    eventId,
  });

  return { success: true };
}

export function formatCalendarLine(event: CalendarEventSummary): string {
  return `- [calendar id=${event.id}] ${event.start} — ${event.summary}`;
}

export async function getUpcomingCalendarLines(
  userId: string,
  limit = 5,
  clock?: RuntimeClockContext,
): Promise<string[]> {
  const lines: string[] = [];
  if (clock) {
    lines.push(formatTodayCalendarLine(clock));
  }

  const result = await listCalendarEvents(userId, {
    maxResults: limit,
  });

  if ("error" in result) return lines;
  lines.push(...result.events.map(formatCalendarLine));
  return lines;
}
