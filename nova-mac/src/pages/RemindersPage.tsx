import { useEffect, useState } from "react";
import { nova } from "../lib/ipc";
import type { ReminderItem } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt) < new Date();
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  const d = new Date(dueAt);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RemindersPage() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await nova().remindersGet();
      setReminders(data as ReminderItem[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function markDone(id: string) {
    await nova().remindersDone(id);
    setReminders((rs) => rs.filter((r) => r.id !== id));
  }

  async function remove(id: string) {
    await nova().remindersDelete(id);
    setReminders((rs) => rs.filter((r) => r.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[--nova-text-secondary]">
        Loading…
      </div>
    );
  }

  if (reminders.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[--nova-text-secondary]">
        No pending reminders
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-3">
      <h1 className="text-lg font-semibold text-[--nova-text]">Reminders</h1>
      {reminders.map((r) => (
        <Card
          key={r.id}
          className={`flex items-start justify-between gap-3 ${isOverdue(r.dueAt) ? "border-amber-500/30" : ""}`}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[--nova-text] font-medium">{r.title}</div>
            <div
              className={`text-xs mt-0.5 ${
                isOverdue(r.dueAt) ? "text-amber-400" : "text-[--nova-text-secondary]"
              }`}
            >
              {formatDue(r.dueAt)}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button size="sm" variant="primary" onClick={() => void markDone(r.id)}>
              Done
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove(r.id)}>
              Delete
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
