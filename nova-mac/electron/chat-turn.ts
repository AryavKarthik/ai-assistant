import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { IpcChannel, type ChatSendRequest } from "@shared/types";
import {
  getUserId,
  inferContextIntent,
  resolveRetrievalPlan,
  applyMacVoiceOverrides,
  preRetrieveContext,
  resolveUserTimezoneCached,
  buildClockForZone,
  buildMacSystemPrompt,
  inferComplexity,
  autoCaptureFromMessage,
  resolveAssistantText,
} from "./memory/index";
import { TOOL_DEFINITIONS } from "./tools/definitions";
import { executeTool, type ToolContext } from "./tools/handlers";
import {
  getOrCreateConversation,
  persistUserMessage,
  persistAssistantMessage,
  loadLastNMessages,
} from "./conversation";

const LIGHT_MODEL =
  process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5-20251001";
const HEAVY_MODEL =
  process.env.ANTHROPIC_MODEL_HEAVY?.trim() || "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS_VOICE = 3;
const MAX_TOOL_ITERATIONS_TEXT = 10;
const RETRIEVAL_DEADLINE_MS = 1200;

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const inFlight = new Map<string, AbortController>();

export function cancelTurn(requestId: string): void {
  inFlight.get(requestId)?.abort();
  inFlight.delete(requestId);
}

function buildMessages(
  history: Array<{ role: "user" | "assistant"; content: string; id: string }>,
  relevantContext: string,
): MessageParam[] {
  return history.map((m, i) => {
    const isLatest = i === history.length - 1 && m.role === "user";
    const content =
      isLatest && relevantContext
        ? `${relevantContext}\n\n${m.content}`
        : m.content;
    return { role: m.role, content };
  });
}

async function retrieveWithDeadline(
  userId: string,
  transcript: string,
  plan: ReturnType<typeof resolveRetrievalPlan>,
  deadlineMs: number,
): Promise<string> {
  const timeout = new Promise<string>((resolve) =>
    setTimeout(() => resolve(""), deadlineMs),
  );
  return Promise.race([
    preRetrieveContext(userId, transcript, plan).catch((err) => {
      console.error("[turn] retrieval failed:", err);
      return "";
    }),
    timeout,
  ]);
}

export async function streamTurn(
  req: ChatSendRequest,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  const isVoice = req.inputModality === "voice";
  const transcript = req.messages.at(-1)?.content ?? "";
  const controller = new AbortController();
  inFlight.set(req.requestId, controller);

  try {
    const userId = await getUserId();
    const conversationId = await getOrCreateConversation(userId);
    const userMsg = await persistUserMessage(conversationId, transcript);

    const intent = inferContextIntent(transcript, "main");
    let plan = resolveRetrievalPlan("main", intent);
    if (isVoice) plan = applyMacVoiceOverrides(plan);

    const complexity = isVoice ? "light" : inferComplexity(transcript);
    const model = complexity === "heavy" ? HEAVY_MODEL : LIGHT_MODEL;
    const maxIterations = isVoice
      ? MAX_TOOL_ITERATIONS_VOICE
      : MAX_TOOL_ITERATIONS_TEXT;
    const maxTokens = isVoice ? 650 : 768;

    const [history, relevantContext, timezone] = await Promise.all([
      loadLastNMessages(conversationId, plan.chatHistoryLimit),
      retrieveWithDeadline(userId, transcript, plan, RETRIEVAL_DEADLINE_MS),
      resolveUserTimezoneCached(userId),
    ]);

    const clock = buildClockForZone(timezone);
    const system = buildMacSystemPrompt(isVoice, clock);
    const messages = buildMessages(history, relevantContext);
    const toolContext: ToolContext = {
      userId,
      conversationId,
      sourceMessageId: userMsg.id,
      userMessage: transcript,
    };

    let fullText = "";
    let iterations = 0;

    while (true) {
      const stream = client().messages.stream(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages,
          tools: TOOL_DEFINITIONS,
        },
        { signal: controller.signal },
      );

      stream.on("text", (delta: string) => {
        fullText += delta;
        emit(IpcChannel.ChatDelta, { requestId: req.requestId, delta });
      });

      const response = await stream.finalMessage();

      if (response.stop_reason !== "tool_use" || iterations >= maxIterations) {
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> =>
          b.type === "tool_use",
      );
      messages.push({ role: "assistant", content: response.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(
            await executeTool(
              block.name,
              block.input as Record<string, unknown>,
              toolContext,
            ),
          ),
        })),
      );
      messages.push({ role: "user", content: toolResults });
      iterations++;
    }

    const resolvedText = resolveAssistantText(fullText, {
      isVoiceTurn: isVoice,
      actionReceipts: [],
    });

    emit(IpcChannel.ChatDone, { requestId: req.requestId, text: resolvedText });

    void persistAssistantMessage(conversationId, resolvedText).catch((e) =>
      console.error("[turn] persist assistant:", e),
    );
    void autoCaptureFromMessage(userId, transcript, userMsg.id).catch((e) =>
      console.error("[memory] capture:", e),
    );
  } catch (err) {
    if (controller.signal.aborted) return;
    emit(IpcChannel.ChatError, {
      requestId: req.requestId,
      message: err instanceof Error ? err.message : "Chat failed",
    });
  } finally {
    inFlight.delete(req.requestId);
  }
}
