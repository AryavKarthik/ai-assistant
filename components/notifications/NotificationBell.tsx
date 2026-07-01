"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { IconBell } from "@tabler/icons-react";
import { fetchJson } from "@/lib/client/fetch";

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ unreadCount: number }>(
        "/api/notifications?limit=1",
      );
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <Link
      href="/notifications"
      className="app-header-notifications"
      aria-label={
        unreadCount > 0
          ? `${unreadCount} unread notifications`
          : "Notifications"
      }
    >
      <IconBell className="h-5 w-5" stroke={1.5} />
      {unreadCount > 0 ? (
        <span className="app-header-notifications-badge">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
