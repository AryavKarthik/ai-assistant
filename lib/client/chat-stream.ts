import type { ChatActionReceipt } from "@/lib/chat/types";
import type { ChatStreamEvent } from "@/lib/chat/stream-events";

export interface ChatStreamDonePayload {
  assistantMessageId: string;
  message: string;
  conversationId: string;
  rotated: boolean;
  modelUsed: string;
  modelPreference: string | null;
  actionReceipts: ChatActionReceipt[];
  trustTags: string[];
  highlightStored: boolean;
}

export interface ChatStreamHandlers {
  onMeta?: (payload: {
    conversationId: string;
    rotated: boolean;
    userMessageId: string;
  }) => void;
  onDelta?: (text: string) => void;
  onDone?: (payload: ChatStreamDonePayload) => void;
  onError?: (error: string) => void;
}

export async function postChatStream(
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "Request failed";
    throw new Error(message);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (!json) continue;

      let event: ChatStreamEvent;
      try {
        event = JSON.parse(json) as ChatStreamEvent;
      } catch {
        continue;
      }

      switch (event.type) {
        case "meta":
          handlers.onMeta?.({
            conversationId: event.conversationId,
            rotated: event.rotated,
            userMessageId: event.userMessageId,
          });
          break;
        case "delta":
          handlers.onDelta?.(event.text);
          break;
        case "done":
          handlers.onDone?.({
            assistantMessageId: event.assistantMessageId,
            message: event.message,
            conversationId: event.conversationId,
            rotated: event.rotated,
            modelUsed: event.modelUsed,
            modelPreference: event.modelPreference,
            actionReceipts: event.actionReceipts,
            trustTags: event.trustTags,
            highlightStored: event.highlightStored,
          });
          break;
        case "error":
          handlers.onError?.(event.error);
          throw new Error(event.error);
      }
    }
  }
}
