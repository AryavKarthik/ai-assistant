const REMINDER_CREATE_PATTERNS: RegExp[] = [
  /\bremind\s+me\b/i,
  /\bset\s+(?:a\s+)?reminder\b/i,
  /\bcreate\s+(?:a\s+)?reminder\b/i,
  /\bdon'?t\s+let\s+me\s+forget\b/i,
  /\bin\s+\d+\s*(?:minute|min|minutes|hour|hr|hours|day|days)\b/i,
];

const REMINDER_DELETE_ALL_PATTERNS: RegExp[] = [
  /\bdelete\s+all\b.*\breminders?\b/i,
  /\bdelete\s+(?:these|those|them)\b.*\breminders?\b/i,
  /\bremove\s+all\b.*\breminders?\b/i,
  /\bclear\s+(?:all\s+)?(?:my\s+)?reminders?\b/i,
];

const REMINDER_COMPLETE_ALL_PATTERNS: RegExp[] = [
  /\bmark\s+all\b.*\breminders?\b.*\b(?:done|complete)\b/i,
  /\bcomplete\s+all\b.*\breminders?\b/i,
];

const AFFIRMATIVE_PATTERN = /^(?:yes|yep|yeah|sure|do it|go ahead|please|ok(?:ay)?)\.?$/i;

export function isReminderCreateIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return REMINDER_CREATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isReminderDeleteAllIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return REMINDER_DELETE_ALL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isReminderCompleteAllIntent(
  message: string,
  recentAssistantText?: string,
): boolean {
  const normalized = message.trim();
  if (!normalized) return false;

  if (REMINDER_COMPLETE_ALL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (!recentAssistantText || !AFFIRMATIVE_PATTERN.test(normalized)) {
    return false;
  }

  return (
    /\bmark\b.*\b(?:all|them)\b.*\b(?:complete|done)\b/i.test(
      recentAssistantText,
    ) ||
    /\b(?:complete|clear)\b.*\b(?:all|them)\b.*\breminders?\b/i.test(
      recentAssistantText,
    )
  );
}

export type ForcedReminderTool =
  | "create_reminder"
  | "delete_all_reminders"
  | "complete_all_reminders"
  | null;

export function getForcedReminderTool(
  message: string,
  recentAssistantText?: string,
): ForcedReminderTool {
  if (isReminderCreateIntent(message)) return "create_reminder";
  if (isReminderDeleteAllIntent(message)) return "delete_all_reminders";
  if (isReminderCompleteAllIntent(message, recentAssistantText)) {
    return "complete_all_reminders";
  }
  return null;
}
