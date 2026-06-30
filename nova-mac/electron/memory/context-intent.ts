import { isWorkoutRecallRelated } from "./keywords";
import { isReminderCreateIntent } from "./reminder-intent";

const GMAIL_CONTEXT_PATTERN =
  /\b(email|emails|gmail|inbox|unread|mailbox|mail|draft|compose|reply|send)\b/i;
function isGmailContextIntent(message: string): boolean {
  return GMAIL_CONTEXT_PATTERN.test(message);
}

export type ThreadSection = "main" | "side";

export type ContextIntent =
  | "general"
  | "profile_recall"
  | "planning"
  | "scheduling"
  | "temporal"
  | "reminders"
  | "email"
  | "workout"
  | "youtube"
  | "thread_focus";

const TEMPORAL_PATTERNS = [
  /\bwhat(?:'s| is) the date\b/i,
  /\bwhat day is (?:it|today)\b/i,
  /\bdo you know the date\b/i,
  /\btoday'?s date\b/i,
  /\bwhat(?:'s| is) today\b/i,
  /\bcurrent date\b/i,
  /\bwhat time is it\b/i,
];

const PROFILE_RECALL_PATTERNS = [
  /\bwhat do you know about me\b/i,
  /\bwhat(?:'s| is) my\b/i,
  /\bwho am i\b/i,
  /\bmy (?:name|major|degree|university|college|job|work|diet|allerg)/i,
  /\bremind me (?:what|who|where)\b/i,
  /\bdo you (?:know|remember) (?:my|that i)\b/i,
  /\btell me about myself\b/i,
  /\bwhat(?:'s| are) my preferences\b/i,
];

const PLANNING_PATTERNS = [
  /\bwhat(?:'s| is) (?:my|the) (?:week|day|schedule|plan)\b/i,
  /\bwhat do i have (?:coming up|going on|today|tomorrow|this week)\b/i,
  /\bhelp me plan\b/i,
  /\bwhat should i do (?:today|tomorrow|this week)\b/i,
  /\bcoming up\b/i,
  /\bagenda\b/i,
];

const SCHEDULING_PATTERNS = [
  /\bcalendar\b/i,
  /\bmeeting\b/i,
  /\bappointment\b/i,
  /\bschedule\b/i,
  /\bwhen am i\b/i,
  /\bfree (?:time|slot)\b/i,
];

const REMINDER_LIST_PATTERNS = [
  /\bwhat reminders\b/i,
  /\bmy reminders\b/i,
  /\bpending (?:tasks|reminders)\b/i,
  /\bwhat(?:'s| is) on my (?:list|todo)\b/i,
];

const THREAD_FOCUS_PATTERNS = [
  /\b(?:as above|from above|like (?:that|before)|make (?:that|it) (?:shorter|longer|clearer|simpler))\b/i,
  /\b(?:continue|keep going|go on|same topic)\b/i,
  /\b(?:rewrite|rephrase|summarize) (?:that|this|it)\b/i,
  /\b(?:what about|how about) (?:that|this)\b/i,
  /\b(?:can you|could you) (?:shorten|expand|clarify) (?:that|this|it)\b/i,
  /^(?:yes|no|ok(?:ay)?|sure|do that|sounds good)\.?$/i,
];

const YOUTUBE_PATTERNS = [
  /\byoutube\b/i,
  /\bwhat should i watch\b/i,
  /\brecommend (?:a |some )?videos?\b/i,
  /\bvideo(?:s)? (?:to watch|about)\b/i,
];

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

export function inferContextIntent(
  message: string,
  threadSection: ThreadSection,
): ContextIntent {
  const normalized = message.trim();
  if (!normalized) return "general";

  if (isReminderCreateIntent(normalized) || matchesAny(normalized, REMINDER_LIST_PATTERNS)) {
    return "reminders";
  }

  if (matchesAny(normalized, TEMPORAL_PATTERNS)) {
    return "temporal";
  }

  if (matchesAny(normalized, SCHEDULING_PATTERNS)) {
    return "scheduling";
  }

  if (matchesAny(normalized, PLANNING_PATTERNS)) {
    return "planning";
  }

  if (matchesAny(normalized, PROFILE_RECALL_PATTERNS)) {
    return "profile_recall";
  }

  if (isGmailContextIntent(normalized)) {
    return "email";
  }

  if (isWorkoutRecallRelated(normalized)) {
    return "workout";
  }

  if (YOUTUBE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "youtube";
  }

  if (
    matchesAny(normalized, THREAD_FOCUS_PATTERNS) ||
    (threadSection === "side" &&
      /\b(?:that|this|it|those|these)\b/i.test(normalized) &&
      normalized.length < 120)
  ) {
    return "thread_focus";
  }

  return "general";
}
