export interface DispatchedReminder {
  id: string;
  title: string;
}

export interface DispatchDueResult {
  notifiedCount: number;
  notified: DispatchedReminder[];
}

const SHOWN_KEY = "shown-reminder-notifications";

function loadShownIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SHOWN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveShownIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...ids]));
}

export function showDueReminderNotifications(
  items: DispatchedReminder[],
): string[] {
  const shown = loadShownIds();
  const newlyShown: string[] = [];

  for (const item of items) {
    if (shown.has(item.id)) continue;
    shown.add(item.id);
    newlyShown.push(item.title);

    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        try {
          new Notification("Reminder due", {
            body: item.title,
            icon: "/favicon.ico",
          });
          continue;
        } catch {
          // fall through to in-app only
        }
      }
    }
  }

  if (newlyShown.length > 0) {
    saveShownIds(shown);
  }

  return newlyShown;
}

export function isPushApiSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window;
}
