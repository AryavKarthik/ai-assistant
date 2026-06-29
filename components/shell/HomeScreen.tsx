"use client";

import { useState } from "react";
import type { ChatMessage, ThreadItem } from "@/lib/chat/types";
import type { VoicePreferences, VoiceSessionState } from "@/lib/voice/types";
import { AppHeader } from "./AppHeader";
import { ConversationPanel } from "./ConversationPanel";
import { ThreadSidebar } from "./ThreadSidebar";

interface HomeScreenProps {
  messages: ChatMessage[];
  isThreadLoading?: boolean;
  error: string | null;
  disabled: boolean;
  threads: ThreadItem[];
  activeThreadId: string | null;
  threadsLoading: boolean;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string, title: string) => void;
  onNewChat: (section: "main" | "side") => void;
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
  voiceWakeWordMode?: boolean;
  voicePassiveWakeListening?: boolean;
  voiceWakePhraseLabel?: string;
  voiceConversationMode: boolean;
  voiceSessionState: VoiceSessionState;
  voiceBargeInActive?: boolean;
  voiceInterimTranscript: string;
  voiceError: string | null;
  voiceAudioLevel: number;
  voiceRecordingSeconds?: number;
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

export function HomeScreen({
  messages,
  isThreadLoading = false,
  error,
  disabled,
  threads,
  activeThreadId,
  threadsLoading,
  onSelectThread,
  onDeleteThread,
  onNewChat,
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
  voiceWakeWordMode = false,
  voicePassiveWakeListening = false,
  voiceWakePhraseLabel = "Hey Nova",
  voiceConversationMode,
  voiceSessionState,
  voiceBargeInActive = false,
  voiceInterimTranscript,
  voiceError,
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
}: HomeScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const voiceModeLabel = voiceWakeWordMode
    ? "Wake"
    : voiceConversationMode
      ? "Conversation"
      : voiceSessionState !== "idle"
        ? "PTT"
        : "Voice";

  return (
    <div className="app-root">
      <AppHeader
        voiceActive={voiceActive}
        voiceWakeWordMode={voiceWakeWordMode}
        voiceModeLabel={voiceModeLabel}
      />
      <div className="app-workspace">
        <ThreadSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          isLoading={threadsLoading}
          mobileOpen={sidebarOpen}
          onMobileClose={() => setSidebarOpen(false)}
          onSelect={onSelectThread}
          onDelete={onDeleteThread}
          onNewChat={onNewChat}
        />
        <div className="app-chat-main">
          <ConversationPanel
            messages={messages}
            isThreadLoading={isThreadLoading}
            error={error}
            onOpenSidebar={() => setSidebarOpen(true)}
            disabled={disabled}
            onSend={onSend}
            onClear={onClear}
            onExtract={onExtract}
            onStreamingComplete={onStreamingComplete}
            onRetry={onRetry}
            onUndoReceipt={onUndoReceipt}
            onConfirmReceipt={onConfirmReceipt}
            onDismissReceipt={onDismissReceipt}
            onApproveWorkflow={onApproveWorkflow}
            onCancelWorkflow={onCancelWorkflow}
            confirmBusyReceiptId={confirmBusyReceiptId}
            voiceActive={voiceActive}
            voiceMemoryFlash={voiceMemoryFlash}
            voiceWakeWordMode={voiceWakeWordMode}
            voicePassiveWakeListening={voicePassiveWakeListening}
            voiceWakePhraseLabel={voiceWakePhraseLabel}
            voiceSessionState={voiceSessionState}
            voiceBargeInActive={voiceBargeInActive}
            voiceInterimTranscript={voiceInterimTranscript}
            voiceError={voiceError}
            voiceConversationMode={voiceConversationMode}
            voiceAudioLevel={voiceAudioLevel}
            voiceRecordingSeconds={voiceRecordingSeconds ?? 0}
            voiceSettingsOpen={voiceSettingsOpen}
            voicePreferences={voicePreferences}
            onVoiceSettingsOpen={onVoiceSettingsOpen}
            onVoiceSettingsClose={onVoiceSettingsClose}
            onVoicePreferencesChange={onVoicePreferencesChange}
            onVoiceDismissError={onVoiceDismissError}
            onVoiceInterrupt={onVoiceInterrupt}
            onVoiceMicTap={onVoiceMicTap}
            onVoiceMicHoldStart={onVoiceMicHoldStart}
            onVoiceMicHoldEnd={onVoiceMicHoldEnd}
            onAttachmentChange={onAttachmentChange}
            composerInitialDraft={composerInitialDraft}
          />
        </div>
      </div>
    </div>
  );
}
