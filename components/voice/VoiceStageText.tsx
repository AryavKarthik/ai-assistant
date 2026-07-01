"use client";

import { memo } from "react";
import { useCatchUpText } from "@/components/chat/useStreamingText";
import { shouldAnimateVoiceStageText } from "@/lib/voice/stage-text";
import type { VoiceVisualMode } from "@/lib/voice/visual-mode";

interface VoiceStageTextProps {
  text: string;
  visualMode: VoiceVisualMode;
}

export const VoiceStageText = memo(function VoiceStageText({
  text,
  visualMode,
}: VoiceStageTextProps) {
  const animate = shouldAnimateVoiceStageText(visualMode, text);
  const visible = useCatchUpText(text, animate);
  const showCursor = animate && visible.length < text.length;

  if (!text) return null;

  return (
    <p className="app-voice-stage-text" aria-live="polite">
      {visible}
      {showCursor ? (
        <span className="app-stream-cursor" aria-hidden>
          ▍
        </span>
      ) : null}
    </p>
  );
});
