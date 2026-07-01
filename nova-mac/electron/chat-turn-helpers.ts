import type { ChatMessage } from "@shared/types";

/** Trim empties, coalesce consecutive same-role turns (Anthropic requires alternation tolerance). */
export function buildAnthropicMessages(
  messages: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  return out;
}
