import type { ChatActionReceipt } from "@/lib/chat/types";

export type ChatStreamEvent =
  | {
      type: "meta";
      conversationId: string;
      rotated: boolean;
      userMessageId: string;
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
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
  | { type: "error"; error: string };

export function encodeSseEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createSseStream(
  handler: (
    emit: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
  ) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const abortController = new AbortController();

      const emit = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };

      try {
        await handler(emit, abortController.signal);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong.";
        controller.enqueue(
          encoder.encode(
            encodeSseEvent({ type: "error", error: message }),
          ),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected
    },
  });
}
