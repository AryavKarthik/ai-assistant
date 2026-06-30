import Anthropic from "@anthropic-ai/sdk";
import { IpcChannel, type ChatMessage, type ChatSendRequest } from "@shared/types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5";
const MAX_TOKENS = 1024;
const SYSTEM_PROMPT =
  "You are Nova, a concise, friendly voice assistant on the user's Mac. " +
  "Replies are spoken aloud, so keep them short and natural — usually 1–3 sentences.";

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

export function cancelChat(requestId: string): void {
  inFlight.get(requestId)?.abort();
  inFlight.delete(requestId);
}

export async function streamChat(
  req: ChatSendRequest,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  const controller = new AbortController();
  inFlight.set(req.requestId, controller);
  let text = "";
  try {
    const stream = client().messages.stream(
      {
        model: DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: buildAnthropicMessages(req.messages),
      },
      { signal: controller.signal },
    );
    stream.on("text", (delta: string) => {
      text += delta;
      emit(IpcChannel.ChatDelta, { requestId: req.requestId, delta });
    });
    await stream.finalMessage();
    emit(IpcChannel.ChatDone, { requestId: req.requestId, text });
  } catch (err) {
    if (controller.signal.aborted) return; // cancelled intentionally — do not emit error
    emit(IpcChannel.ChatError, {
      requestId: req.requestId,
      message: err instanceof Error ? err.message : "Chat failed",
    });
  } finally {
    inFlight.delete(req.requestId);
  }
}
