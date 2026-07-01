"use client";

import { AssistantMessageContent } from "./AssistantMessageContent";

interface StreamingMessageTextProps {
  text: string;
  streaming: boolean;
  onTick?: () => void;
  onComplete?: () => void;
}

export function StreamingMessageText(props: StreamingMessageTextProps) {
  return <AssistantMessageContent {...props} />;
}
