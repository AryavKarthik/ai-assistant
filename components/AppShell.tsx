"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppDock } from "@/components/navigation/AppDock";
import { TabTransition } from "@/components/shell/TabTransition";
import { fetchJson } from "@/lib/client/fetch";
import { showDueReminderNotifications } from "@/lib/client/local-notifications";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dueAlert, setDueAlert] = useState<string | null>(null);

  const isAuthPage =
    pathname === "/login" || pathname.startsWith("/auth/");

  useEffect(() => {
    if (isAuthPage) return;

    const dispatchDue = async () => {
      try {
        const data = await fetchJson<{
          notifiedCount: number;
          notified: Array<{ id: string; title: string }>;
        }>("/api/reminders/dispatch-due", { method: "POST" });

        if (data.notifiedCount > 0 && data.notified.length > 0) {
          const titles = showDueReminderNotifications(data.notified);
          if (titles.length > 0) {
            setDueAlert(titles.join(" · "));
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    void dispatchDue();
    const intervalId = window.setInterval(dispatchDue, 30_000);
    return () => window.clearInterval(intervalId);
  }, [isAuthPage, pathname]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell flex h-dvh max-h-dvh flex-col overflow-hidden bg-black text-[#ececee]">
      {dueAlert && (
        <div className="shrink-0 border-b border-[rgb(255_255_255/6%)] bg-[#050505] px-4 py-2 text-center text-sm text-[#b0b4bb]">
          Reminder due: {dueAlert}
          <button
            type="button"
            onClick={() => setDueAlert(null)}
            className="ml-3 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-24">
        <TabTransition>{children}</TabTransition>
      </main>
      <AppDock />
    </div>
  );
}
