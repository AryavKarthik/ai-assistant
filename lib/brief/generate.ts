import { getAnthropicClient, getCandidateModels } from "@/lib/anthropic/client";
import type { RuntimeClockContext } from "@/lib/chat/runtime-context";
import { formatRuntimeClockForPrompt } from "@/lib/chat/runtime-context";

const BRIEF_SYSTEM = `You are a personal assistant writing a concise daily brief.
- Use bullet points grouped by: priorities, calendar, reminders, email (if any).
- Be specific with times and titles from context only; do not invent events.
- Keep under 350 words. Warm but efficient tone.
- If context is sparse, say so briefly and suggest one focus for the day.`;

export async function generateDailyBriefText(
  relevantContext: string,
  clock: RuntimeClockContext,
): Promise<string> {
  const client = getAnthropicClient();
  const models = getCandidateModels("light");

  const userContent = relevantContext
    ? `${relevantContext}\n\nGenerate a concise daily brief for ${clock.localDate}.`
    : `No calendar or reminder context is available.\n\nGenerate a very short daily brief for ${clock.localDate} encouraging the user to check their schedule.`;

  const system = `${BRIEF_SYSTEM}\n\n${formatRuntimeClockForPrompt(clock)}`;

  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: userContent }],
      });

      const text = response.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (text) return text;
    } catch (error) {
      lastError = error;
      console.warn(`[brief] model ${model} failed:`, error);
    }
  }

  throw lastError ?? new Error("Failed to generate daily brief");
}

export function buildFallbackBrief(clock: RuntimeClockContext): string {
  return `Good morning — it's ${clock.localDate}. Open the app to see your calendar and reminders for today.`;
}
