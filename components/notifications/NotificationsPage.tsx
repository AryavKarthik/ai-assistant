"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/client/fetch";
import type { ProactiveNotification } from "@/lib/proactive/types";
import { Button, Card, EmptyState, Notice } from "@/components/ui/primitives";
import { PageShell } from "@/components/shell/PageShell";
import { LoadingScreen } from "@/components/shell/LoadingScreen";

function typeLabel(type: ProactiveNotification["type"]): string {
  switch (type) {
    case "daily_brief":
      return "Daily brief";
    case "deadline_nudge":
      return "Deadline";
    case "overdue_nudge":
      return "Overdue";
    case "conflict_nudge":
      return "Conflict";
    case "follow_up":
      return "Follow-up";
    default:
      return "Notification";
  }
}

export function NotificationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("id");

  const [notifications, setNotifications] = useState<ProactiveNotification[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchJson<{
        notifications: ProactiveNotification[];
      }>("/api/notifications");
      setNotifications(data.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: string) {
    setBusyId(id);
    try {
      await fetchJson(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  function openNotification(n: ProactiveNotification) {
    void act(n.id, "read");

    if (n.type === "daily_brief" && typeof n.payload.brief_text === "string") {
      return;
    }

    const prompt = n.payload.suggested_prompt;
    if (typeof prompt === "string") {
      router.push(`/?prompt=${encodeURIComponent(prompt)}`);
      return;
    }

    if (n.type === "deadline_nudge" || n.type === "overdue_nudge") {
      router.push("/reminders");
    }
  }

  if (isLoading) {
    return <LoadingScreen fullPage />;
  }

  return (
    <PageShell
      title="Notifications"
      subtitle="Briefs, nudges, and follow-up suggestions from your assistant."
    >
      <div className="mx-auto flex max-w-lg flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}

        {notifications.length === 0 ? (
          <EmptyState
            title="No notifications"
            detail="When you opt in to proactive features, briefs and nudges appear here."
          />
        ) : (
          notifications.map((n) => (
            <Card
              key={n.id}
              className={`flex flex-col gap-2 p-4${highlightId === n.id ? " ring-1 ring-[#7dd3fc]" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-[#8b9099]">
                  {typeLabel(n.type)}
                </span>
                <span className="text-xs text-[#666]">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              <h2 className="font-medium">{n.title}</h2>
              <p className="text-sm text-[#b0b4bb] whitespace-pre-wrap">
                {n.type === "daily_brief" &&
                typeof n.payload.brief_text === "string"
                  ? n.payload.brief_text
                  : n.body}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  disabled={busyId === n.id}
                  onClick={() => openNotification(n)}
                >
                  Open
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyId === n.id}
                  onClick={() => void act(n.id, "snooze_1h")}
                >
                  Snooze 1h
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyId === n.id}
                  onClick={() => void act(n.id, "dismiss")}
                >
                  Dismiss
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </PageShell>
  );
}
