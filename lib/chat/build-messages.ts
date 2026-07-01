import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { EphemeralImage } from "@/lib/chat/image";
import type { Message } from "@/lib/supabase/types";

const IMAGE_ONLY_PROMPT = "What's in this image?";

// Builds the messages[] array sent to Claude from DB history + pre-fetched context.
export function buildClaudeMessages({
  history,
  relevantContext,
  ephemeralImage,
}: {
  history: Message[];
  relevantContext: string;
  ephemeralImage?: EphemeralImage;
}): MessageParam[] {
  return history.map((msg, index) => {
    const isLatestUser =
      index === history.length - 1 && msg.role === "user";

    let text = msg.content;
    if (isLatestUser && relevantContext) {
      text = `${relevantContext}\n\n${msg.content}`;
    }
    if (isLatestUser && !text.trim()) {
      text = IMAGE_ONLY_PROMPT;
    }

    if (isLatestUser && ephemeralImage) {
      return {
        role: msg.role,
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: ephemeralImage.mediaType,
              data: ephemeralImage.data,
            },
          },
          {
            type: "text",
            text,
          },
        ],
      };
    }

    return {
      role: msg.role,
      content: text,
    };
  });
}
