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
import { getToolDefinitions } from "./tools/definitions";
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
const RETRIEVAL_DEADLINE_VOICE_MS = 800;

// Friendly labels shown in the orb while a tool runs.
const TOOL_STEP_LABELS: Record<string, string> = {
  save_memory: "Saving that…",
  search_memory: "Searching memory…",
  log_workout: "Logging workout…",
  list_workouts: "Checking workouts…",
  search_workouts: "Checking workouts…",
  create_reminder: "Setting reminder…",
  list_reminders: "Checking reminders…",
  complete_reminder: "Updating reminders…",
  complete_all_reminders: "Updating reminders…",
  delete_reminder: "Updating reminders…",
  delete_all_reminders: "Updating reminders…",
  list_calendar_events: "Checking your calendar…",
  create_calendar_event: "Adding to your calendar…",
  update_calendar_event: "Updating your calendar…",
  delete_calendar_event: "Updating your calendar…",
  search_gmail: "Searching Gmail…",
  get_gmail_message: "Reading email…",
  create_gmail_draft: "Drafting email…",
  get_youtube_taste_profile: "Checking YouTube…",
  search_youtube: "Searching YouTube…",
  recommend_youtube: "Finding videos…",
  web_search: "Searching the web…",
  fetch_webpage: "Reading page…",
  set_timer: "Setting timer…",
  list_timers: "Checking timers…",
  cancel_timer: "Cancelling timer…",
  open_app: "Opening app…",
  quit_app: "Quitting app…",
  open_url: "Opening page…",
  set_system_volume: "Adjusting volume…",
  get_system_volume: "Checking volume…",
  set_screen_brightness: "Adjusting brightness…",
  run_applescript: "Controlling your Mac…",
  run_shortcut: "Running shortcut…",
  list_shortcuts: "Checking shortcuts…",
  check_mac_permissions: "Checking permissions…",
  composio_search_tools: "Finding the right tool…",
  composio_execute: "Working in your apps…",
};

function toolStepLabel(name: string): string {
  return TOOL_STEP_LABELS[name] ?? "Working on it…";
}

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

/** Warms the per-turn caches (auth user, conversation id, timezone) while the
 *  user is still speaking — called from main on wake detection so the first
 *  reply doesn't pay cold Supabase round-trips. All three memoize internally. */
export async function prewarmTurn(): Promise<void> {
  try {
    const userId = await getUserId();
    await Promise.all([
      getOrCreateConversation(userId),
      resolveUserTimezoneCached(userId),
    ]);
  } catch (err) {
    console.warn("[turn] prewarm skipped:", err instanceof Error ? err.message : err);
  }
}

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

    const intent = inferContextIntent(transcript, "main");
    let plan = resolveRetrievalPlan("main", intent);
    if (isVoice) plan = applyMacVoiceOverrides(plan);

    // Voice used to be pinned to the light model; letting genuinely complex
    // spoken asks route to the heavy model makes voice answers as smart as
    // typed ones — the streaming STT path buys back the extra first-token time.
    const complexity = inferComplexity(transcript);
    const model = complexity === "heavy" ? HEAVY_MODEL : LIGHT_MODEL;
    const maxIterations = isVoice
      ? MAX_TOOL_ITERATIONS_VOICE
      : MAX_TOOL_ITERATIONS_TEXT;
    const maxTokens = isVoice ? 650 : 768;

    // Persist the user message in parallel with history/retrieval/timezone —
    // it used to be a serial Supabase round-trip blocking the whole turn
    // before retrieval even started, adding hundreds of ms to every reply.
    // The persisted row may or may not land in the history query depending on
    // timing, so dedupe it by id and append the transcript ourselves.
    const [userMsg, history, relevantContext, timezone] = await Promise.all([
      persistUserMessage(conversationId, transcript),
      loadLastNMessages(conversationId, plan.chatHistoryLimit),
      retrieveWithDeadline(
        userId,
        transcript,
        plan,
        isVoice ? RETRIEVAL_DEADLINE_VOICE_MS : RETRIEVAL_DEADLINE_MS,
      ),
      resolveUserTimezoneCached(userId),
    ]);

    const clock = buildClockForZone(timezone);
    const system = buildMacSystemPrompt(isVoice, clock);
    const messages = buildMessages(
      [
        ...history.filter((m) => m.id !== userMsg.id),
        { id: userMsg.id, role: "user" as const, content: transcript },
      ],
      relevantContext,
    );
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
          tools: getToolDefinitions(),
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

      if (toolUseBlocks.length > 0) {
        emit(IpcChannel.ChatToolUse, {
          requestId: req.requestId,
          toolName: toolUseBlocks[0].name,
          step: toolStepLabel(toolUseBlocks[0].name),
        });
      }

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
