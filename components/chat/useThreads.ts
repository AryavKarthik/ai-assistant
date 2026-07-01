"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/client/fetch";
import type { ThreadItem } from "@/lib/chat/types";

export function useThreads(refreshKey = 0) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeThreadId = searchParams.get("thread");

  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadThreads = useCallback(async () => {
    try {
      const data = await fetchJson<{ conversations: ThreadItem[] }>(
        "/api/conversations",
      );
      setThreads(data.conversations ?? []);
    } catch {
      setThreads([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreads();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads, refreshKey]);

  const switchThread = useCallback(
    (threadId: string) => {
      router.push(`/?thread=${threadId}`);
    },
    [router],
  );

  const createThread = useCallback(
    async (section: "main" | "side" = "main") => {
      const data = await fetchJson<{ conversationId: string }>(
        "/api/conversations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section }),
        },
      );
      router.push(`/?thread=${data.conversationId}`);
      await loadThreads();
      return data.conversationId;
    },
    [loadThreads, router],
  );

  const deleteThread = useCallback(
    async (threadId: string, title: string) => {
      if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) {
        return false;
      }

      try {
        await fetchJson(`/api/conversations/${threadId}`, { method: "DELETE" });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not delete conversation.";
        window.alert(message);
        return false;
      }

      const remaining = threads.filter((thread) => thread.id !== threadId);
      setThreads(remaining);

      if (activeThreadId === threadId) {
        if (remaining.length > 0) {
          router.push(`/?thread=${remaining[0].id}`);
        } else {
          await createThread("main");
        }
      } else {
        await loadThreads();
      }
      return true;
    },
    [activeThreadId, createThread, loadThreads, router, threads],
  );

  return {
    threads,
    activeThreadId,
    isLoading,
    switchThread,
    createThread,
    deleteThread,
  };
}
