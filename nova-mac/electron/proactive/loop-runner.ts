import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { AgentLoop } from "@shared/types";
import {
  getUserId,
  resolveUserTimezoneCached,
  buildClockForZone,
  formatRuntimeClockForPrompt,
  MAC_VOICE_SYSTEM_PROMPT,
  inferComplexity,
} from "../memory/index";
import { getPersonalityBlock } from "../personality/store";
import { getToolDefinitions } from "../tools/definitions";
import { executeTool, type ToolContext } from "../tools/handlers";
import {
  getOrCreateConversation,
  persistUserMessage,
  persistAssistantMessage,
} from "../conversation";
import { describeSchedule } from "./schedule";

const LIGHT_MODEL = process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5-20251001";
const HEAVY_MODEL = process.env.ANTHROPIC_MODEL_HEAVY?.trim() || "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 8;
const MAX_TOKENS = 700;

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const LOOP_CONTEXT_PROMPT = `Scheduled autonomous run:
- This turn was triggered by a schedule the user set up earlier, NOT by the user speaking — nobody is there to answer questions, so never ask one. If something is ambiguous, make the sensible call and note it.
- Execute the instruction NOW using your tools. The user already approved this action when they created the schedule — that standing approval covers outward-facing steps the instruction itself asks for (e.g. sending the email it describes). Don't ask for confirmation.
- Your final message is spoken aloud to the user as an announcement. Keep it to 1–2 spoken-style sentences: what you did (or found), and anything they need to know. No markdown.
- If a tool fails, say plainly what failed and the one-line fix. Never claim success a tool result doesn't confirm.`;

/** Runs one agent loop as a full tool-enabled chat turn and returns the final
 *  assistant text (what gets spoken/notified). Throws on hard failures. */
export async function runAgentLoop(loop: AgentLoop): Promise<string> {
  const userId = await getUserId();
  const conversationId = await getOrCreateConversation(userId);
  const timezone = await resolveUserTimezoneCached(userId);
  const clock = buildClockForZone(timezone);

  // Persisted so the run is visible in conversation history (and so tool
  // handlers get a real source message id for FK-backed inserts).
  const userMsg = await persistUserMessage(
    conversationId,
    `[Scheduled task "${loop.name}" — ${describeSchedule(loop.schedule)}] ${loop.instruction}`,
  );

  const system = [
    {
      type: "text" as const,
      text: `${MAC_VOICE_SYSTEM_PROMPT}${getPersonalityBlock()}\n\n${LOOP_CONTEXT_PROMPT}`,
      cache_control: { type: "ephemeral" as const },
    },
    { type: "text" as const, text: formatRuntimeClockForPrompt(clock) },
  ];

  const messages: MessageParam[] = [{ role: "user", content: loop.instruction }];
  const toolContext: ToolContext = {
    userId,
    conversationId,
    sourceMessageId: userMsg.id,
    userMessage: loop.instruction,
  };
  const model = inferComplexity(loop.instruction) === "heavy" ? HEAVY_MODEL : LIGHT_MODEL;
  const tools = getToolDefinitions();

  let finalText = "";
  let iterations = 0;
  while (true) {
    const response = await client().messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      tools,
    });

    finalText = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (response.stop_reason !== "tool_use" || iterations >= MAX_TOOL_ITERATIONS) break;

    const toolUseBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    messages.push({ role: "assistant", content: response.content });
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: JSON.stringify(
          await executeTool(block.name, block.input as Record<string, unknown>, toolContext),
        ),
      })),
    );
    messages.push({ role: "user", content: toolResults });
    iterations++;
  }

  const text = finalText.trim() || `Ran "${loop.name}".`;
  void persistAssistantMessage(conversationId, text).catch((e) =>
    console.error("[loop] persist assistant:", e),
  );
  return text;
}
