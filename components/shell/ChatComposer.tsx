"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceSessionState } from "@/lib/voice/types";
import { unlockAudioPlayback } from "@/lib/voice/audio-unlock";
import { appIconClass, IconCamera, IconMicrophone, IconSend } from "./icons";

const MIN_INPUT_HEIGHT = 40;
const MIC_HOLD_MS = 180;

function getMaxInputHeight(): number {
  if (typeof window === "undefined") return 448;
  return Math.min(window.innerHeight * 0.45, 448);
}

interface ChatComposerProps {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onSend: (text: string, file?: File) => void;
  onBeforeSend?: () => void;
  onHeightChange?: (height: number) => void;
  onFocusChange?: (focused: boolean) => void;
  onAttachmentChange?: (hasAttachment: boolean) => void;
  voiceDisabled?: boolean;
  voiceSessionState?: VoiceSessionState;
  conversationMode?: boolean;
  wakeWordMode?: boolean;
  passiveWakeListening?: boolean;
  wakePhraseLabel?: string;
  onMicTap?: () => void;
  onMicHoldStart?: () => void;
  onMicHoldEnd?: () => void;
  micButtonRef?: React.RefObject<HTMLButtonElement | null>;
  initialDraft?: string;
}

export function ChatComposer({
  inputRef,
  fileRef,
  disabled,
  onSend,
  onBeforeSend,
  onHeightChange,
  onFocusChange,
  onAttachmentChange,
  voiceDisabled = false,
  voiceSessionState = "idle",
  conversationMode = false,
  wakeWordMode = false,
  passiveWakeListening = false,
  wakePhraseLabel = "Hey Nova",
  onMicTap,
  onMicHoldStart,
  onMicHoldEnd,
  micButtonRef,
  initialDraft,
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreviewUrl, setAttachedPreviewUrl] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdActiveRef = useRef(false);

  const hasDraft = draft.trim().length > 0;
  const canSend = hasDraft || Boolean(attachedFile);

  useEffect(() => {
    if (initialDraft?.trim()) {
      setDraft(initialDraft.trim());
    }
  }, [initialDraft]);

  const micDisabled = disabled || voiceDisabled || Boolean(attachedFile);
  const micInterruptible =
    voiceSessionState === "assistant_speaking" ||
    voiceSessionState === "assistant_streaming";
  const micActive =
    conversationMode ||
    wakeWordMode ||
    passiveWakeListening ||
    voiceSessionState === "listening" ||
    voiceSessionState === "processing_stt" ||
    voiceSessionState === "assistant_speaking";
  const micClassName = [
    "app-compose-icon-btn",
    "app-compose-mic",
    micActive ? "app-compose-mic-active" : "",
    conversationMode ? "app-compose-mic-conversation" : "",
    wakeWordMode ? "app-compose-mic-wake" : "",
    micInterruptible ? "app-compose-mic-interrupt" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const measureHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(
      Math.max(el.scrollHeight, MIN_INPUT_HEIGHT),
      getMaxInputHeight(),
    );
    el.style.height = `${next}px`;
    setInputHeight(next);
  }, [inputRef]);

  useEffect(() => {
    onHeightChange?.(inputHeight);
  }, [inputHeight, onHeightChange]);

  useEffect(() => {
    onAttachmentChange?.(Boolean(attachedFile));
  }, [attachedFile, onAttachmentChange]);

  useEffect(() => {
    const onResize = () => measureHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureHeight]);

  function resetInput() {
    setDraft("");
    setInputHeight(MIN_INPUT_HEIGHT);
    if (attachedPreviewUrl) {
      URL.revokeObjectURL(attachedPreviewUrl);
    }
    setAttachedFile(null);
    setAttachedPreviewUrl(null);
    if (inputRef.current) {
      inputRef.current.style.height = `${MIN_INPUT_HEIGHT}px`;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if ((!value && !attachedFile) || disabled) return;
    onBeforeSend?.();
    onSend(value, attachedFile ?? undefined);
    resetInput();
  }

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handleMicPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (micDisabled) return;
    unlockAudioPlayback();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    holdActiveRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdActiveRef.current = true;
      onMicHoldStart?.();
    }, MIC_HOLD_MS);
  }

  function handleMicPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (micDisabled) return;
    clearHoldTimer();
    if (holdActiveRef.current) {
      onMicHoldEnd?.();
      holdActiveRef.current = false;
    } else {
      onMicTap?.();
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function handleMicPointerCancel() {
    clearHoldTimer();
    if (holdActiveRef.current) {
      onMicHoldEnd?.();
      holdActiveRef.current = false;
    }
  }

  useEffect(
    () => () => {
      if (attachedPreviewUrl) {
        URL.revokeObjectURL(attachedPreviewUrl);
      }
      clearHoldTimer();
    },
    [attachedPreviewUrl],
  );

  return (
    <form className="app-compose-shell" onSubmit={handleSubmit}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (attachedPreviewUrl) {
              URL.revokeObjectURL(attachedPreviewUrl);
            }
            setAttachedFile(file);
            setAttachedPreviewUrl(URL.createObjectURL(file));
            onFocusChange?.(true);
          }
          e.target.value = "";
        }}
      />
      {attachedPreviewUrl ? (
        <div className="app-compose-attachment">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachedPreviewUrl}
            alt="Selected attachment"
            className="app-compose-attachment-preview"
          />
          <button
            type="button"
            className="app-compose-attachment-remove"
            onClick={() => {
              if (attachedPreviewUrl) {
                URL.revokeObjectURL(attachedPreviewUrl);
              }
              setAttachedFile(null);
              setAttachedPreviewUrl(null);
            }}
          >
            Remove image
          </button>
          <span className="app-compose-attachment-name">{attachedFile?.name}</span>
        </div>
      ) : null}
      <div className="app-compose-field">
        <div className="app-compose-controls">
          <button
            type="button"
            className="app-compose-icon-btn"
            disabled={disabled}
            aria-label="Attach image"
            onClick={() => fileRef.current?.click()}
          >
            <IconCamera className={appIconClass} />
          </button>
          <button
            ref={micButtonRef}
            type="button"
            className={micClassName}
            disabled={micDisabled}
            aria-label={
              micInterruptible
                ? "Hold to interrupt and talk"
                : conversationMode
                  ? "Turn off voice conversation mode"
                  : wakeWordMode
                    ? "Turn off wake word mode"
                    : "Hold to talk, tap for conversation mode"
            }
            aria-pressed={micActive}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerCancel}
          >
            <IconMicrophone className={appIconClass} />
          </button>
        </div>

        <div className="app-compose-input-wrap">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder="Message Assistant…"
            disabled={disabled}
            className="app-compose-input"
            style={{ height: inputHeight }}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            onChange={(e) => {
              setDraft(e.target.value);
              measureHeight();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
        </div>

        <div className="app-compose-controls">
          <button
            type="submit"
            className={`app-compose-icon-btn app-compose-send${canSend ? " app-compose-send-ready" : ""}`}
            disabled={disabled || !canSend}
            aria-label={disabled ? "Sending" : "Send message"}
            title={disabled ? "Sending..." : "Send message"}
          >
            <IconSend className={appIconClass} />
          </button>
        </div>
      </div>
      {passiveWakeListening && !conversationMode && voiceSessionState === "idle" ? (
        <p className="app-compose-wake-hint">
          Listening for <strong>{wakePhraseLabel}</strong>
        </p>
      ) : null}
    </form>
  );
}
