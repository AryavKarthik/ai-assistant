"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/client/fetch";
import { subscribeToPushNotifications } from "@/lib/client/push";
import { isPushApiSupported } from "@/lib/client/local-notifications";
import {
  Button,
  Card,
  EmptyState,
  InlineError,
  Notice,
  TextInput,
} from "@/components/ui/primitives";
import { PageShell } from "@/components/shell/PageShell";
import { LoadingScreen } from "@/components/shell/LoadingScreen";
import {
  formatDueDate,
  groupReminders,
  GROUP_LABELS,
  GROUP_ORDER,
  type ReminderItem,
} from "./types";

function getNotificationPermission():
  | NotificationPermission
  | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function RemindersTab() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDueAt, setNewDueAt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    getNotificationPermission,
  );
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<
    Array<{ id: string; summary: string; start: string }>
  >([]);

  const loadReminders = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const data = await fetchJson<{ reminders: ReminderItem[] }>(
        "/api/reminders?forTab=true",
      );
      setReminders(data.reminders ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load reminders.",
      );
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReminders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReminders]);

  useEffect(() => {
    let cancelled = false;
    const loadCalendar = async () => {
      try {
        const data = await fetchJson<{
          events: Array<{ id: string; summary: string; start: string }>;
        }>("/api/google/calendar/upcoming");
        if (!cancelled) {
          setCalendarEvents(data.events ?? []);
        }
      } catch {
        if (!cancelled) {
          setCalendarEvents([]);
        }
      }
    };
    void loadCalendar();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void loadReminders();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadReminders]);

  async function handleEnableNotifications() {
    setIsEnablingPush(true);
    setPushMessage(null);
    setActionMessage(null);
    setError(null);
    try {
      await subscribeToPushNotifications();
      setNotificationPermission(getNotificationPermission());
      setPushMessage("Notifications enabled for due reminders.");
    } catch (err) {
      setNotificationPermission(getNotificationPermission());
      setError(
        err instanceof Error
          ? err.message
          : "Could not enable notifications.",
      );
    } finally {
      setIsEnablingPush(false);
    }
  }

  async function handleMarkDone(id: string) {
    setCompletingId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      setReminders((prev) => prev.filter((r) => r.id !== id));
      setActionMessage("Reminder marked done.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setCompletingId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          due_at: newDueAt ? new Date(newDueAt).toISOString() : null,
        }),
      });
      setNewTitle("");
      setNewDueAt("");
      await loadReminders();
      setActionMessage("Reminder created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsCreating(false);
    }
  }

  const groups = groupReminders(reminders);

  if (isLoading) {
    return (
      <PageShell title="Reminders">
        <LoadingScreen />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Reminders"
      subtitle="Your day planner — tasks plus upcoming events"
    >

      {error && (
        <InlineError
          message={error}
          className="mb-4"
          actions={
            <>
              <Button type="button" onClick={() => void loadReminders()} variant="secondary" className="px-3 py-1.5 text-xs">
                Retry
              </Button>
              <Button type="button" onClick={() => setError(null)} variant="ghost" className="px-3 py-1.5 text-xs">
                Dismiss
              </Button>
            </>
          }
        />
      )}
      {actionMessage ? <Notice tone="success" className="mb-4">{actionMessage}</Notice> : null}
      {isRefreshing && !isLoading ? (
        <Notice tone="neutral" className="mb-4 text-xs">Refreshing reminders...</Notice>
      ) : null}

      {notificationPermission !== "unsupported" && (
        <Card className="mb-4 px-4 py-3">
          {notificationPermission === "default" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="ui-text-secondary text-sm">
                Get a browser notification when a reminder is due.
              </p>
              <Button
                type="button"
                onClick={handleEnableNotifications}
                disabled={isEnablingPush}
                className="shrink-0"
              >
                {isEnablingPush ? "Enabling..." : "Enable notifications"}
              </Button>
            </div>
          )}
          {notificationPermission === "granted" && (
            <p className="ui-text-secondary text-sm">
              {pushMessage ?? "Notifications enabled for due reminders."}
              {!isPushApiSupported() && (
                <span className="mt-1 block text-[#ffd37a]">
                  This browser may not show background push alerts. Keep the app
                  open — you will still get an in-app banner and a system alert
                  when a reminder is due.
                </span>
              )}
            </p>
          )}
          {notificationPermission === "denied" && (
            <p className="ui-text-secondary text-sm">
              Notifications are blocked in your browser settings.
            </p>
          )}
        </Card>
      )}

      <form
        onSubmit={handleCreate}
        className="ui-surface mb-6 flex flex-col gap-2 p-4"
      >
        <TextInput
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New reminder..."
        />
        <div className="flex gap-2">
          <TextInput
            type="datetime-local"
            value={newDueAt}
            onChange={(e) => setNewDueAt(e.target.value)}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={isCreating || !newTitle.trim()}
          >
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </div>
      </form>

      {calendarEvents.length > 0 ? (
        <section className="ui-surface mb-6 p-4">
          <h2 className="mb-2 text-sm font-semibold">Upcoming calendar events</h2>
          <ul className="space-y-2">
            {calendarEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm">{event.summary}</span>
                <span className="ui-muted shrink-0 text-xs">
                  {formatDueDate(event.start)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reminders.length === 0 ? (
        <EmptyState
          title="No pending reminders"
          detail="Ask in chat to create one, or add one above."
          className="flex-1"
        />
      ) : (
        <div className="flex flex-col gap-6">
          {GROUP_ORDER.map((label) => {
            const items = groups[label];
            if (items.length === 0) return null;

            return (
              <section key={label}>
                <h2
                  className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
                    label === "overdue"
                      ? "text-red-600 dark:text-red-400"
                      : "ui-muted"
                  }`}
                >
                  {GROUP_LABELS[label]}
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((reminder) => (
                    <li
                      key={reminder.id}
                      className="ui-surface flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {reminder.title}
                        </p>
                        <p className="ui-muted text-xs">
                          {formatDueDate(reminder.due_at)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => handleMarkDone(reminder.id)}
                        disabled={completingId === reminder.id}
                        variant="secondary"
                        className="shrink-0 px-3 py-1.5 text-xs"
                      >
                        {completingId === reminder.id ? "Marking done..." : "Mark done"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
