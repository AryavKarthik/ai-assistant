import { IpcChannel } from "@shared/types";
import type { ChatSendRequest } from "@shared/types";
import { streamTurn, cancelTurn } from "./chat-turn";

export { buildAnthropicMessages } from "./chat-turn-helpers";

export function cancelChat(requestId: string): void {
  cancelTurn(requestId);
}

export async function streamChat(
  req: ChatSendRequest,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  return streamTurn(req, emit);
}
