"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat/types";
import type { VoicePreferences, VoiceSessionState } from "@/lib/voice/types";
import { formatModelLabel } from "@/lib/chat/format-model-label";
import { AssistantMessageContent } from "@/components/chat/AssistantMessageContent";
import { TypingLoader } from "@/components/ui/loader";
import { ActionReceiptRow } from "@/components/ui/primitives";
import { WorkflowCard } from "@/components/chat/WorkflowCard";
import { VoiceOverlay } from "@/components/voice/VoiceOverlay";
import { VoiceOnboarding, shouldShowVoiceOnboarding } from "@/components/voice/VoiceOnboarding";
import { VoiceSettingsPanel } from "@/components/voice/VoiceSettingsPanel";
import { ChatComposer } from "./ChatComposer";
import { ConversationHeader } from "./ConversationHeader";

interface ConversationPanelProps {
  messages: ChatMessage[];
  isThreadLoading?: boolean;
  error: string | null;
  onOpenSidebar: () => void;
  disabled: boolean;
  onSend: (text: string, file?: File) => void;
  onClear: () => void;
  onExtract: () => void;
  onStreamingComplete: (messageId: string) => void;
  onRetry: () => void;
  onUndoReceipt: (messageId: string, receiptId: string) => void;
  onConfirmReceipt: (messageId: string, receiptId: string) => void;
  onDismissReceipt: (messageId: string, receiptId: string) => void;
  onApproveWorkflow: (messageId: string, receiptId: string, completedReceipts: import("@/lib/chat/types").ChatActionReceipt[]) => void;
  onCancelWorkflow: (messageId: string, receiptId: string) => void;
  confirmBusyReceiptId?: string | null;
  voiceActive: boolean;
  voiceMemoryFlash?: boolean;
  voiceWakeWordMode: boolean;
  voicePassiveWakeListening?: boolean;
  voiceWakePhraseLabel?: string;
  voiceSessionState: VoiceSessionState;
  voiceBargeInActive?: boolean;
  voiceInterimTranscript: string;
  voiceError: string | null;
  voiceConversationMode: boolean;
  voiceAudioLevel: number;
  voiceRecordingSeconds: number;
  voiceSettingsOpen: boolean;
  voicePreferences: VoicePreferences;
  onVoiceSettingsOpen: () => void;
  onVoiceSettingsClose: () => void;
  onVoicePreferencesChange: (patch: Partial<VoicePreferences>) => void;
  onVoiceDismissError: () => void;
  onVoiceInterrupt: () => void;
  onVoiceMicTap: () => void;
  onVoiceMicHoldStart: () => void;
  onVoiceMicHoldEnd: () => void;
  onAttachmentChange: (hasAttachment: boolean) => void;
  composerInitialDraft?: string;
}

function currentAssistantTurnText(
  messages: ChatMessage[],
  sessionState: VoiceSessionState,
): string {
  if (
    sessionState !== "assistant_streaming" &&
    sessionState !== "assistant_speaking"
  ) {
    return "";
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant") {
      return message.content;
    }
    if (message.role === "user") {
      break;
    }
  }

  return "";
}

function formatTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ConversationPanel({
  messages,
  isThreadLoading = false,
  error,
  onOpenSidebar,
  disabled,
  onSend,
  onClear,
  onExtract,
  onStreamingComplete,
  onRetry,
  onUndoReceipt,
  onConfirmReceipt,
  onDismissReceipt,
  onApproveWorkflow,
  onCancelWorkflow,
  confirmBusyReceiptId,
  voiceActive,
  voiceMemoryFlash = false,
  voiceWakeWordMode,
  voicePassiveWakeListening = false,
  voiceWakePhraseLabel = "Hey Nova",
  voiceSessionState,
  voiceBargeInActive = false,
  voiceInterimTranscript,
  voiceError,
  voiceConversationMode,
  voiceAudioLevel,
  voiceRecordingSeconds,
  voiceSettingsOpen,
  voicePreferences,
  onVoiceSettingsOpen,
  onVoiceSettingsClose,
  onVoicePreferencesChange,
  onVoiceDismissError,
  onVoiceInterrupt,
  onVoiceMicTap,
  onVoiceMicHoldStart,
  onVoiceMicHoldEnd,
  onAttachmentChange,
  composerInitialDraft,
}: ConversationPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const showOnboarding =
    voiceActive &&
    shouldShowVoiceOnboarding() &&
    !onboardingDismissed &&
    !voiceSettingsOpen;

  const scrollToBottomIfPinned = useCallback(() => {
    if (!stickToBottom.current) return;
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottomIfPinned();
  }, [messages, scrollToBottomIfPinned]);

  const handleComposerHeightChange = useCallback(() => {
    requestAnimationFrame(scrollToBottomIfPinned);
  }, [scrollToBottomIfPinned]);

  function handleMessagesScroll() {
    const el = messagesRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }

  const showWelcome =
    messages.length === 0 && !isThreadLoading && !messages.some((m) => m.isPending);
  const quickActions = [
    "Plan my day in 5 steps",
    "Draft a professional email reply",
    "Summarize my latest priorities",
  ];

  const assistantTurnText = useMemo(
    () => currentAssistantTurnText(messages, voiceSessionState),
    [messages, voiceSessionState],
  );

  const voiceCurrentTopic = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && msg.content?.trim()) {
        const firstLine = msg.content.trim().split("\n")[0];
        return firstLine.length > 42 ? `${firstLine.slice(0, 39)}…` : firstLine;
      }
    }
    return undefined;
  }, [messages]);

  return (
    <section className="app-conversation">
      <ConversationHeader
        onOpenSidebar={onOpenSidebar}
        onClear={onClear}
        onExtract={onExtract}
      />

      <div
        ref={messagesRef}
        className={`app-messages${isThreadLoading ? " app-messages-loading" : ""}`}
        onScroll={handleMessagesScroll}
      >
        {showWelcome && (
          <div className="app-landing">
            <h2 className="app-landing-title">What&apos;s on the agenda today?</h2>
            <p className="app-landing-subtitle">
              Start with a prompt, attach an image, or ask for a quick plan.
            </p>
            <div className="app-landing-actions">
              {quickActions.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="app-landing-action"
                  onClick={() => onSend(prompt)}
                  disabled={disabled}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`app-bubble ${message.role === "user" ? "user" : "assistant"}${
              message.isPending ? " app-bubble-pending" : ""
            }${message.highlightStored ? " app-bubble-stored" : ""}`}
          >
            {message.hasImage && message.imagePreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.imagePreviewUrl}
                alt="Attached"
                className="mb-2 max-h-32 rounded-[14px] border border-[var(--ui-border-soft)] object-cover"
              />
            ) : null}

            {message.isPending ? (
              <TypingLoader size="sm" className="[&_div]:bg-[var(--ui-text-dim)]" />
            ) : message.role === "assistant" ? (
              <AssistantMessageContent
                text={message.content}
                streaming={Boolean(message.isStreaming)}
                onTick={message.isStreaming ? scrollToBottomIfPinned : undefined}
                onComplete={
                  message.isStreaming
                    ? () => onStreamingComplete(message.id)
                    : undefined
                }
              />
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}

            {!message.isPending && !message.isStreaming ? (
              <div className="app-bubble-meta">
                {message.role === "assistant" && message.modelUsed ? (
                  <span className="app-bubble-model">
                    {formatModelLabel(message.modelUsed)}
                  </span>
                ) : null}
                <span className="app-bubble-time">
                  {formatTime(message.createdAt)}
                </span>
              </div>
            ) : null}
            {message.role === "assistant" && message.trustTags?.length ? (
              <div className="app-trust-tags">
                {message.trustTags.map((tag) => (
                  <span key={`${message.id}-${tag}`} className="app-trust-tag">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {message.role === "assistant" &&
            (message.actionReceipts ?? []).some(
              (receipt) => receipt.source !== "memory",
            ) ? (
              <div className="app-action-receipts">
                {(message.actionReceipts ?? [])
                  .filter((receipt) => receipt.source !== "memory")
                  .map((receipt) => {
                    // Render WorkflowCard for approve_workflow receipts that haven't been dismissed
                    if (
                      receipt.confirm?.type === "approve_workflow" &&
                      !receipt.dismissed
                    ) {
                      return (
                        <WorkflowCard
                          key={receipt.id}
                          workflowId={receipt.confirm.workflowId}
                          title={receipt.confirm.title}
                          steps={receipt.confirm.steps}
                          onComplete={(completedReceipts) =>
                            onApproveWorkflow(message.id, receipt.id, completedReceipts)
                          }
                          onCancel={() => onCancelWorkflow(message.id, receipt.id)}
                        />
                      );
                    }

                    // Default: render the compact receipt row
                    return (
                      <ActionReceiptRow
                        key={receipt.id}
                        receipt={receipt}
                        confirmBusy={confirmBusyReceiptId === receipt.id}
                        onUndo={() => onUndoReceipt(message.id, receipt.id)}
                        onConfirm={() => onConfirmReceipt(message.id, receipt.id)}
                        onDismiss={() => onDismissReceipt(message.id, receipt.id)}
                      />
                    );
                  })}
              </div>
            ) : null}
          </div>
        ))}

        {error ? (
          <div className="app-bubble app-bubble-error">
            <p>{error}</p>
            <button
              type="button"
              className="app-inline-action"
              onClick={onRetry}
              disabled={disabled}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>

      <VoiceOverlay
        visible={voiceActive}
        micAnchorRef={micButtonRef}
        sessionState={voiceSessionState}
        statusText={voiceInterimTranscript}
        assistantTurnText={assistantTurnText}
        conversationMode={voiceConversationMode}
        wakeWordMode={voiceWakeWordMode}
        bargeInActive={voiceBargeInActive}
        audioLevel={voiceAudioLevel}
        error={voiceError}
        onStop={onVoiceInterrupt}
        onOpenSettings={onVoiceSettingsOpen}
        onDismissError={onVoiceDismissError}
        currentTopic={voiceCurrentTopic}
        memoryFlash={voiceMemoryFlash}
      />

      <VoiceSettingsPanel
        open={voiceSettingsOpen}
        preferences={voicePreferences}
        onChange={onVoicePreferencesChange}
        onClose={onVoiceSettingsClose}
      />

      <VoiceOnboarding
        key={showOnboarding ? "open" : "closed"}
        open={showOnboarding}
        onClose={() => setOnboardingDismissed(true)}
      />

      <ChatComposer
        inputRef={inputRef}
        fileRef={fileRef}
        disabled={disabled}
        onSend={onSend}
        onBeforeSend={() => {
          stickToBottom.current = true;
        }}
        onHeightChange={handleComposerHeightChange}
        onFocusChange={(focused) => {
          if (focused) stickToBottom.current = true;
        }}
        onAttachmentChange={onAttachmentChange}
        voiceDisabled={false}
        voiceSessionState={voiceSessionState}
        conversationMode={voiceConversationMode}
        wakeWordMode={voiceWakeWordMode}
        passiveWakeListening={voicePassiveWakeListening}
        wakePhraseLabel={voiceWakePhraseLabel}
        onMicTap={onVoiceMicTap}
        onMicHoldStart={onVoiceMicHoldStart}
        onMicHoldEnd={onVoiceMicHoldEnd}
        micButtonRef={micButtonRef}
        initialDraft={composerInitialDraft}
      />
    </section>
  );
}
