function parseRelativeDueAt(message: string): Date | null {
  const match = message.match(
    /\bin\s+(\d+)\s*(minute|min|minutes|hour|hr|hours|day|days)\b/i,
  );
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  const ms = unit.startsWith("min")
    ? amount * 60_000
    : unit.startsWith("hour") || unit.startsWith("hr")
      ? amount * 3_600_000
      : amount * 86_400_000;

  return new Date(Date.now() + ms);
}

function parseClockDueAt(message: string): Date | null {
  const match = message.match(
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3].toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  const now = new Date();
  const due = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0,
  );

  if (due.getTime() <= now.getTime() && !/\btoday\b/i.test(message)) {
    due.setDate(due.getDate() + 1);
  }

  return due;
}

export function resolveReminderDueAt(
  userMessage: string,
  modelDueAt?: string | null,
): string | null {
  const relative = parseRelativeDueAt(userMessage);
  if (relative) return relative.toISOString();

  const clock = parseClockDueAt(userMessage);
  if (clock) return clock.toISOString();

  if (modelDueAt) {
    const parsed = new Date(modelDueAt);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}
