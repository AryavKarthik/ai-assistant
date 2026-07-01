import type { ChatActionReceipt } from "@/lib/chat/types";

const MEMORY_FALLBACK =
  "Got it — thanks for sharing. I'll keep that in mind going forward.";

export function voiceSpokenFallback(
  actionReceipts: ChatActionReceipt[],
): string {
  if (actionReceipts.length === 0) {
    return "I'm not sure I understood — can you say that again?";
  }

  const failed = actionReceipts.some((r) => r.status === "error");
  if (failed) {
    return "I couldn't complete that — want to try again?";
  }

  const last = actionReceipts[actionReceipts.length - 1]!;
  return `Done. ${last.outcome}.`;
}

export function resolveAssistantText(
  rawText: string,
  options: {
    isVoiceTurn: boolean;
    actionReceipts: ChatActionReceipt[];
    isMemoryIntent?: boolean;
  },
): string {
  if (rawText.trim()) return rawText.trim();

  if (options.isVoiceTurn) {
    return voiceSpokenFallback(options.actionReceipts);
  }

  if (options.isMemoryIntent) {
    return MEMORY_FALLBACK;
  }

  return MEMORY_FALLBACK;
}
