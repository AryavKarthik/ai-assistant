import type { ChatActionReceipt, TurnUsage } from "@/lib/chat/types";

export interface AssistantMessageMetadata {
  modelUsed?: string;
  trustTags?: string[];
  actionReceipts?: ChatActionReceipt[];
  highlightStored?: boolean;
  inputModality?: "voice" | "text";
  cacheUsage?: TurnUsage;
}

export function buildAssistantMetadata(result: {
  modelUsed: string;
  trustTags: string[];
  actionReceipts: ChatActionReceipt[];
  highlightStored: boolean;
  inputModality?: "voice" | "text";
  cacheUsage?: TurnUsage;
}): AssistantMessageMetadata {
  return {
    modelUsed: result.modelUsed,
    trustTags: result.trustTags,
    actionReceipts: result.actionReceipts,
    highlightStored: result.highlightStored,
    ...(result.inputModality ? { inputModality: result.inputModality } : {}),
    ...(result.cacheUsage ? { cacheUsage: result.cacheUsage } : {}),
  };
}

export function parseMessageMetadata(
  raw: unknown,
): AssistantMessageMetadata {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;

  const trustTags = Array.isArray(record.trustTags)
    ? record.trustTags.filter((tag): tag is string => typeof tag === "string")
    : undefined;

  const actionReceipts = Array.isArray(record.actionReceipts)
    ? (record.actionReceipts as ChatActionReceipt[])
    : undefined;

  const rawCacheUsage = record.cacheUsage;
  const cacheUsage: TurnUsage | undefined =
    rawCacheUsage &&
    typeof rawCacheUsage === "object" &&
    "inputTokens" in rawCacheUsage
      ? (rawCacheUsage as TurnUsage)
      : undefined;

  return {
    modelUsed:
      typeof record.modelUsed === "string" ? record.modelUsed : undefined,
    trustTags,
    actionReceipts,
    highlightStored:
      typeof record.highlightStored === "boolean"
        ? record.highlightStored
        : undefined,
    cacheUsage,
  };
}

export function toClientMessage(msg: {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  metadata?: unknown;
}) {
  const meta =
    msg.role === "assistant" ? parseMessageMetadata(msg.metadata) : {};

  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
    ...(msg.role === "assistant"
      ? {
          modelUsed: meta.modelUsed,
          trustTags: meta.trustTags,
          actionReceipts: meta.actionReceipts,
          highlightStored: meta.highlightStored,
        }
      : {}),
  };
}
