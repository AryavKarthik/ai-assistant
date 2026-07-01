import { isReminderCreateIntent } from "@/lib/chat/reminder-intent";
import {
  extractExplicitMemoryContent,
  isSelfDisclosureMessage,
} from "@/lib/memory/lifestyle-capture";

const EXPLICIT_MEMORY_PATTERNS: RegExp[] = [
  /^remember\s+(?:that\s+)?(?!to\b)/i,
  /^please\s+remember\s+(?:that\s+)?(?!to\b)/i,
  /^keep\s+in\s+mind\s+(?:that\s+)?/i,
  /^save\s+(?:this|that)\s+to\s+memory/i,
  /^save\s+to\s+memory/i,
  /\bcan you remember\s+(?:that\s+)?(?!to\b)/i,
  /\bplease\s+save\s+(?:this|that)\s+(?:to\s+memory)?/i,
];

export function isExplicitMemorySaveIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (isReminderCreateIntent(normalized)) return false;
  return (
    EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    extractExplicitMemoryContent(normalized) !== null
  );
}

export function isLifestyleMemoryIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || isReminderCreateIntent(normalized)) return false;
  if (isExplicitMemorySaveIntent(normalized)) return false;
  return isSelfDisclosureMessage(normalized) && normalized.length >= 20;
}

export function getForcedMemoryTool(message: string): "save_memory" | null {
  if (isExplicitMemorySaveIntent(message)) return "save_memory";
  if (isLifestyleMemoryIntent(message)) return "save_memory";
  return null;
}
