export interface ReminderItem {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  created_at: string;
}

export type ReminderDueLabel =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "no_due_date";

export function getReminderDueLabel(dueAt: string | null): ReminderDueLabel {
  if (!dueAt) return "no_due_date";

  const due = new Date(dueAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (due < startOfToday) return "overdue";
  if (due < endOfToday) return "due_today";
  return "upcoming";
}

export function formatDueDate(dueAt: string | null): string {
  if (!dueAt) return "No due date";

  const due = new Date(dueAt);
  return due.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const GROUP_LABELS: Record<ReminderDueLabel, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  no_due_date: "No due date",
};

const GROUP_ORDER: ReminderDueLabel[] = [
  "overdue",
  "due_today",
  "upcoming",
  "no_due_date",
];

export function groupReminders(
  reminders: ReminderItem[],
): Record<ReminderDueLabel, ReminderItem[]> {
  const groups: Record<ReminderDueLabel, ReminderItem[]> = {
    overdue: [],
    due_today: [],
    upcoming: [],
    no_due_date: [],
  };

  for (const reminder of reminders) {
    groups[getReminderDueLabel(reminder.due_at)].push(reminder);
  }

  return groups;
}

export { GROUP_LABELS, GROUP_ORDER };
