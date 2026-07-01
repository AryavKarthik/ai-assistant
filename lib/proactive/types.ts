export type ProactiveTier = "off" | "reminders_only" | "full";

export type ProactiveNotificationType =
  | "daily_brief"
  | "deadline_nudge"
  | "overdue_nudge"
  | "conflict_nudge"
  | "follow_up";

export type ProactiveNotificationStatus =
  | "unread"
  | "read"
  | "dismissed"
  | "snoozed";

export interface UserPreferences {
  user_id: string;
  proactive_tier: ProactiveTier;
  brief_enabled: boolean;
  brief_time_local: string;
  timezone: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  push_proactive_enabled: boolean;
  last_brief_local_date: string | null;
  updated_at: string;
}

export interface ProactiveNotification {
  id: string;
  user_id: string;
  type: ProactiveNotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: ProactiveNotificationStatus;
  snoozed_until: string | null;
  sent_at: string | null;
  created_at: string;
}

export const DEFAULT_USER_PREFERENCES: Omit<
  UserPreferences,
  "user_id" | "updated_at"
> = {
  proactive_tier: "off",
  brief_enabled: false,
  brief_time_local: "08:00:00",
  timezone: "UTC",
  quiet_hours_start: "22:00:00",
  quiet_hours_end: "08:00:00",
  push_proactive_enabled: true,
  last_brief_local_date: null,
};

export const MAX_NUDGES_PER_USER_PER_DAY = 3;
