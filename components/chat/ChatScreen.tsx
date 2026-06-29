"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readImageAttachment } from "@/lib/chat/attachments";
import {
  loadModelPreference,
  saveModelPreference,
} from "@/lib/chat/model-preference";
import { playMemoryEarcon } from "@/lib/voice/earcon";
import type {
  ChatActionReceipt,
  ChatImageAttachment,
  ChatMessage,
} from "@/lib/chat/types";
import { fetchJson } from "@/lib/client/fetch";
import { postChatStream } from "@/lib/client/chat-stream";
import { rememberClientTimeZone } from "@/lib/client/timezone";
import { getWakePhraseLabel } from "@/lib/voice/wake/phrases";
import { HomeScreen } from "@/components/shell/HomeScreen";
import { LoadingScreen } from "@/components/shell/LoadingScreen";
import { useVoiceSession } from "./useVoiceSession";
import { useThreads } from "./useThreads";

async function persistMessageReceipts(
  messageId: string,
  actionReceipts: ChatActionReceipt[],
) {
  if (
    messageId.startsWith("assistant-") ||
    messageId.startsWith("assistant-pending-") ||
    messageId.startsWith("temp-")
  ) {
    return;
  }

  try {
    await fetchJson(`/api/messages/${encodeURIComponent(messageId)}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionReceipts }),
    });
  } catch (err) {
    console.error("Failed to persist receipt state:", err);
  }
}

export function ChatScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [modelPreference, setModelPreference] = useState<string | null>(() =>
    loadModelPreference(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const [threadRefreshKey, setThreadRefreshKey] = useState(0);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const [confirmBusyReceiptId, setConfirmBusyReceiptId] = useState<string | null>(
    null,
  );
  const [voiceMemoryFlash, setVoiceMemoryFlash] = useState(false);
  const memoryFlashTimerRef = useRef<number | null>(null);
  const [hasImageAttachment, setHasImageAttachment] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const voiceTurnAbortedRef = useRef(false);
  const voiceActionsRef = useRef({
    beginStreamingReply: () => {},
    feedStreamingReply: (_delta: string) => {},
    endStreamingReply: async () => {},
    speakReply: async (_text: string) => {},
    speakInstantAck: async () => {},
    stopSpeaking: () => {},
    notifyAssistantTurnComplete: () => {},
    conversationMode: false,
    disableVoiceMode: () => {},
    voiceActive: false,
    instantAckEnabled: true,
  });

  const isAssistantStreaming = useMemo(
    () => messages.some((message) => message.isStreaming),
    [messages],
  );

  const {
    threads,
    activeThreadId,
    isLoading: threadsLoading,
    switchThread,
    createThread,
    deleteThread,
  } = useThreads(threadRefreshKey);

  const loadConversation = useCallback(async () => {
    if (!initialLoadDone.current) {
      setIsInitializing(true);
    } else {
      setIsThreadLoading(true);
    }
    setError(null);

    try {
      if (threadParam) {
        const data = await fetchJson<{
          conversationId: string;
          messages: ChatMessage[];
          rotated?: boolean;
        }>(`/api/conversations/${threadParam}`);
        setConversationId(data.conversationId);
        setMessages(data.messages ?? []);
        if (data.rotated && data.conversationId !== threadParam) {
          router.replace(`/?thread=${data.conversationId}`);
          setThreadRefreshKey((key) => key + 1);
        }
        return;
      }

      const data = await fetchJson<{
        conversationId: string;
        messages: ChatMessage[];
      }>("/api/conversations/active");
      setConversationId(data.conversationId);
      setMessages(data.messages ?? []);
      router.replace(`/?thread=${data.conversationId}`);
    } catch {
      setError("Could not load your conversation. Check your connection and retry.");
    } finally {
      setIsInitializing(false);
      setIsThreadLoading(false);
      initialLoadDone.current = true;
    }
  }, [router, threadParam]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConversation();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversation]);

  const bumpThreads = useCallback(() => {
    setThreadRefreshKey((key) => key + 1);
  }, []);

  const cancelActiveTurn = useCallback(
    (options?: { keepVoiceSession?: boolean }) => {
      voiceTurnAbortedRef.current = true;
      if (!options?.keepVoiceSession) {
        voiceActionsRef.current.stopSpeaking();
      }
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      setIsLoading(false);

      const pendingId = pendingAssistantIdRef.current;
      pendingAssistantIdRef.current = null;

      setMessages((prev) =>
        prev
          .filter(
            (message) =>
              !(pendingId && message.id === pendingId && message.isPending),
          )
          .map((message) =>
            message.isStreaming || message.isPending
              ? { ...message, isStreaming: false, isPending: false }
              : message,
          ),
      );
    },
    [],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      image?: ChatImageAttachment,
      options?: { inputModality?: "voice" },
    ) => {
      const optimisticId = `temp-${Date.now()}`;
      const pendingAssistantId = `assistant-pending-${Date.now()}`;
      pendingAssistantIdRef.current = pendingAssistantId;

      const isVoiceTurn =
        options?.inputModality === "voice" ||
        voiceActionsRef.current.conversationMode;
      voiceTurnAbortedRef.current = false;

      let voiceReplyText: string | null = null;
      let streamingReplyStarted = false;
      let instantAckTimer: number | null = null;

      const userMessage: ChatMessage = {
        id: optimisticId,
        role: "user",
        content: text || (image ? "[Image attached]" : ""),
        hasImage: Boolean(image),
        imagePreviewUrl: image?.previewUrl,
      };

      const pendingAssistant: ChatMessage = {
        id: pendingAssistantId,
        role: "assistant",
        content: "",
        isPending: true,
      };

      setMessages((prev) => [...prev, userMessage, pendingAssistant]);
      setIsLoading(true);
      setError(null);

      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;

      if (isVoiceTurn && voiceActionsRef.current.instantAckEnabled) {
        instantAckTimer = window.setTimeout(() => {
          if (!streamingReplyStarted && !voiceTurnAbortedRef.current) {
            void voiceActionsRef.current.speakInstantAck();
          }
        }, 2500);
      }

      try {
        if (isVoiceTurn) {
          let assistantContent = "";
          let streamDone:
            | {
                assistantMessageId: string;
                message: string;
                conversationId: string;
                rotated: boolean;
                modelUsed: string;
                modelPreference: string | null;
                actionReceipts: ChatActionReceipt[];
                trustTags: string[];
                highlightStored: boolean;
              }
            | undefined;

          await postChatStream(
            {
              message: text,
              conversationId,
              modelPreference,
              inputModality: "voice",
              clientTimeZone: rememberClientTimeZone(),
              image: image
                ? { mediaType: image.mediaType, data: image.data }
                : undefined,
            },
            controller.signal,
            {
              onDelta: (delta) => {
                assistantContent += delta;
                if (!streamingReplyStarted) {
                  streamingReplyStarted = true;
                  if (instantAckTimer !== null) {
                    window.clearTimeout(instantAckTimer);
                    instantAckTimer = null;
                  }
                  voiceActionsRef.current.stopSpeaking();
                  voiceActionsRef.current.beginStreamingReply();
                }
                voiceActionsRef.current.feedStreamingReply(delta);
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === pendingAssistantId
                      ? {
                          ...message,
                          content: assistantContent,
                          isPending: false,
                        }
                      : message,
                  ),
                );
              },
              onDone: (payload) => {
                streamDone = payload;
              },
            },
          );

          if (!streamDone) {
            throw new Error("Stream ended without completion.");
          }

          const data = streamDone;

          setConversationId(data.conversationId);
          if (data.conversationId && data.conversationId !== threadParam) {
            router.replace(`/?thread=${data.conversationId}`);
          }
          if (data.rotated) {
            bumpThreads();
          }
          if ("modelPreference" in data) {
            const nextPreference =
              typeof data.modelPreference === "string"
                ? data.modelPreference
                : null;
            setModelPreference(nextPreference);
            saveModelPreference(nextPreference);
          }

          pendingAssistantIdRef.current = null;

          const voiceHighlightStored = data.rotated ? Boolean(data.highlightStored) : false;
          if (data.highlightStored) triggerMemoryFlash();

          const assistantMessage: ChatMessage = {
            id: data.assistantMessageId,
            role: "assistant",
            content: data.message,
            isStreaming: false,
            modelUsed:
              typeof data.modelUsed === "string" ? data.modelUsed : undefined,
            actionReceipts: Array.isArray(data.actionReceipts)
              ? data.actionReceipts
              : [],
            trustTags: Array.isArray(data.trustTags)
              ? data.trustTags
              : ["Temporary"],
            highlightStored: voiceHighlightStored,
          };

          if (data.rotated) {
            setMessages([
              { ...userMessage, id: optimisticId },
              assistantMessage,
            ]);
          } else {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === pendingAssistantId ? assistantMessage : message,
              ),
            );
          }
          bumpThreads();
        } else {
        const data = await fetchJson<{
          conversationId: string;
          assistantMessageId?: string;
          message: string;
          rotated?: boolean;
          modelPreference?: string | null;
          modelUsed?: string;
          actionReceipts?: ChatActionReceipt[];
          trustTags?: string[];
          highlightStored?: boolean;
        }>("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId,
            modelPreference,
            inputModality: options?.inputModality,
            clientTimeZone: rememberClientTimeZone(),
            image: image
              ? { mediaType: image.mediaType, data: image.data }
              : undefined,
          }),
          signal: controller.signal,
        });

        setConversationId(data.conversationId);
        if (data.conversationId && data.conversationId !== threadParam) {
          router.replace(`/?thread=${data.conversationId}`);
        }
        if (data.rotated) {
          bumpThreads();
        }
        if ("modelPreference" in data) {
          const nextPreference =
            typeof data.modelPreference === "string"
              ? data.modelPreference
              : null;
          setModelPreference(nextPreference);
          saveModelPreference(nextPreference);
        }

        const assistantId =
          typeof data.assistantMessageId === "string"
            ? data.assistantMessageId
            : `assistant-${Date.now()}`;
        pendingAssistantIdRef.current = null;

        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: data.message,
          isStreaming: isVoiceTurn ? false : !data.rotated,
          modelUsed:
            typeof data.modelUsed === "string" ? data.modelUsed : undefined,
          actionReceipts: Array.isArray(data.actionReceipts)
            ? data.actionReceipts
            : [],
          trustTags: Array.isArray(data.trustTags)
            ? data.trustTags
            : ["Temporary"],
          highlightStored: data.rotated ? Boolean(data.highlightStored) : false,
        };

        if (data.rotated) {
          setMessages([
            { ...userMessage, id: optimisticId },
            assistantMessage,
          ]);
        } else {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === pendingAssistantId ? assistantMessage : message,
            ),
          );
        }
        bumpThreads();

        if (isVoiceTurn && data.message) {
          voiceReplyText = data.message;
        }
        }
      } catch (err) {
        if (instantAckTimer !== null) {
          window.clearTimeout(instantAckTimer);
        }
        if (err instanceof Error && err.name === "AbortError") {
          voiceTurnAbortedRef.current = true;
          return;
        }
        setError(
          err instanceof Error ? err.message : "Something went wrong.",
        );
        pendingAssistantIdRef.current = null;
        setMessages((prev) =>
          prev.filter(
            (m) => m.id !== optimisticId && m.id !== pendingAssistantId,
          ),
        );
      } finally {
        if (instantAckTimer !== null) {
          window.clearTimeout(instantAckTimer);
        }
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
        }
        setIsLoading(false);
      }

      if (voiceTurnAbortedRef.current) {
        return;
      }

      if (isVoiceTurn) {
        try {
          if (streamingReplyStarted) {
            await voiceActionsRef.current.endStreamingReply();
          }
          voiceActionsRef.current.notifyAssistantTurnComplete();
        } catch {
          voiceActionsRef.current.notifyAssistantTurnComplete();
        }
      } else if (voiceReplyText) {
        try {
          await voiceActionsRef.current.speakReply(voiceReplyText);
        } catch {
          voiceActionsRef.current.notifyAssistantTurnComplete();
        }
      }
    },
    [bumpThreads, conversationId, modelPreference, router, threadParam],
  );

  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const voice = useVoiceSession({
    disabled: isThreadLoading,
    isAssistantBusy: isLoading,
    isAssistantStreaming,
    hasImageAttachment,
    onSendTranscript: async (text) => {
      await sendMessageRef.current(text, undefined, { inputModality: "voice" });
    },
    onBargeIn: cancelActiveTurn,
  });

  const voiceRef = useRef({
    voiceActive: false,
    disableVoiceMode: voice.disableVoiceMode,
    notifyAssistantTurnComplete: voice.notifyAssistantTurnComplete,
    conversationMode: voice.conversationMode,
    wakeWordMode: voice.wakeWordMode,
  });
  useEffect(() => {
    voiceActionsRef.current = {
      beginStreamingReply: voice.beginStreamingReply,
      feedStreamingReply: voice.feedStreamingReply,
      endStreamingReply: voice.endStreamingReply,
      speakReply: voice.speakReply,
      speakInstantAck: voice.speakInstantAck,
      stopSpeaking: voice.stopSpeaking,
      notifyAssistantTurnComplete: voice.notifyAssistantTurnComplete,
      conversationMode: voice.conversationMode,
      disableVoiceMode: voice.disableVoiceMode,
      voiceActive: voice.voiceActive,
      instantAckEnabled:
      voice.preferences.instantAck ||
      voice.preferences.instantAckMode !== "off",
    };
    voiceRef.current = {
      voiceActive: voice.voiceActive,
      disableVoiceMode: voice.disableVoiceMode,
      notifyAssistantTurnComplete: voice.notifyAssistantTurnComplete,
      conversationMode: voice.conversationMode,
      wakeWordMode: voice.wakeWordMode,
    };
  }, [
    voice.beginStreamingReply,
    voice.endStreamingReply,
    voice.feedStreamingReply,
    voice.conversationMode,
    voice.wakeWordMode,
    voice.disableVoiceMode,
    voice.notifyAssistantTurnComplete,
    voice.speakReply,
    voice.speakInstantAck,
    voice.stopSpeaking,
    voice.voiceActive,
  ]);

  const handleAttachmentChange = useCallback((hasAttachment: boolean) => {
    setHasImageAttachment(hasAttachment);
    if (hasAttachment && voiceRef.current.voiceActive) {
      void voiceRef.current.disableVoiceMode();
    }
  }, []);

  const prevAssistantBusyRef = useRef(false);
  useEffect(() => {
    const busy = isLoading || isAssistantStreaming;
    if (
      prevAssistantBusyRef.current &&
      !busy &&
      voiceRef.current.conversationMode &&
      !voiceTurnAbortedRef.current
    ) {
      voiceRef.current.notifyAssistantTurnComplete();
    }
    prevAssistantBusyRef.current = busy;
  }, [isAssistantStreaming, isLoading]);

  const triggerMemoryFlash = useCallback(() => {
    if (!voiceRef.current.voiceActive) return;
    playMemoryEarcon();
    if (memoryFlashTimerRef.current !== null) {
      window.clearTimeout(memoryFlashTimerRef.current);
    }
    setVoiceMemoryFlash(true);
    memoryFlashTimerRef.current = window.setTimeout(() => {
      memoryFlashTimerRef.current = null;
      setVoiceMemoryFlash(false);
    }, 1600);
  }, []);

  const handleStreamingComplete = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;
        const shouldHighlightStored = (message.actionReceipts ?? []).some(
          (receipt) =>
            receipt.source === "memory" &&
            receipt.status === "success" &&
            Boolean(receipt.undo),
        );
        const anyMemoryStored = (message.actionReceipts ?? []).some(
          (receipt) =>
            receipt.source === "memory" && receipt.status === "success",
        );
        if (anyMemoryStored) triggerMemoryFlash();
        return {
          ...message,
          isStreaming: false,
          highlightStored: shouldHighlightStored,
        };
      }),
    );
    window.setTimeout(() => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? { ...message, highlightStored: false }
            : message,
        ),
      );
    }, 3500);
    if (
      !voiceTurnAbortedRef.current &&
      voiceRef.current.conversationMode
    ) {
      voiceRef.current.notifyAssistantTurnComplete();
    }
  }, []);

  const handleUndoReceipt = useCallback(
    async (messageId: string, receiptId: string) => {
      const message = messages.find((item) => item.id === messageId);
      const receipt = message?.actionReceipts?.find((item) => item.id === receiptId);
      if (!receipt?.undo) return;

      try {
        if (receipt.undo.type === "delete_memory") {
          await fetchJson(`/api/memories/${receipt.undo.targetId}`, {
            method: "DELETE",
          });
        } else if (receipt.undo.type === "restore_reminder_pending") {
          await fetchJson(`/api/reminders/${receipt.undo.targetId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "pending", forMemory: true }),
          });
        }
        setMessages((prev) =>
          prev.map((item) =>
            item.id !== messageId
              ? item
              : {
                  ...item,
                  actionReceipts: (item.actionReceipts ?? []).map((itemReceipt) =>
                    itemReceipt.id === receiptId
                      ? { ...itemReceipt, outcome: "Undone", undo: undefined }
                      : itemReceipt,
                  ),
                },
          ),
        );
        const updatedReceipts = (message?.actionReceipts ?? []).map((itemReceipt) =>
          itemReceipt.id === receiptId
            ? { ...itemReceipt, outcome: "Undone", undo: undefined }
            : itemReceipt,
        );
        await persistMessageReceipts(messageId, updatedReceipts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not undo action.");
      }
    },
    [messages],
  );

  const handleConfirmReceipt = useCallback(
    async (messageId: string, receiptId: string) => {
      const message = messages.find((item) => item.id === messageId);
      const receipt = message?.actionReceipts?.find((item) => item.id === receiptId);
      if (receipt?.confirm?.type !== "send_gmail_draft") return;

      setConfirmBusyReceiptId(receiptId);
      setError(null);
      try {
        await fetchJson<{ success: boolean }>(
          `/api/google/gmail/drafts/${encodeURIComponent(receipt.confirm.draftId)}/send`,
          { method: "POST" },
        );
        const updatedReceipts = (message?.actionReceipts ?? []).map((itemReceipt) =>
          itemReceipt.id === receiptId
            ? {
                ...itemReceipt,
                status: "success" as const,
                outcome: "Email sent",
                confirm: undefined,
                dismissed: undefined,
              }
            : itemReceipt,
        );
        setMessages((prev) =>
          prev.map((item) =>
            item.id !== messageId
              ? item
              : {
                  ...item,
                  actionReceipts: updatedReceipts,
                },
          ),
        );
        await persistMessageReceipts(messageId, updatedReceipts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send email.");
      } finally {
        setConfirmBusyReceiptId(null);
      }
    },
    [messages],
  );

  const handleDismissReceipt = useCallback(
    async (messageId: string, receiptId: string) => {
      const message = messages.find((item) => item.id === messageId);
      const updatedReceipts = (message?.actionReceipts ?? []).map((itemReceipt) =>
        itemReceipt.id === receiptId
          ? {
              ...itemReceipt,
              outcome: "Draft saved in Gmail",
              confirm: undefined,
              dismissed: true,
            }
          : itemReceipt,
      );
      setMessages((prev) =>
        prev.map((item) =>
          item.id !== messageId
            ? item
            : {
                ...item,
                actionReceipts: updatedReceipts,
              },
        ),
      );
      await persistMessageReceipts(messageId, updatedReceipts);
    },
    [messages],
  );

  const handleApproveWorkflow = useCallback(
    (messageId: string, receiptId: string, completedReceipts: ChatActionReceipt[]) => {
      // Mark the plan receipt as dismissed and append the execution receipts
      setMessages((prev) =>
        prev.map((item) => {
          if (item.id !== messageId) return item;
          const updatedReceipts = (item.actionReceipts ?? []).map((r) =>
            r.id === receiptId ? { ...r, dismissed: true } : r,
          );
          return {
            ...item,
            actionReceipts: [...updatedReceipts, ...completedReceipts],
          };
        }),
      );
      // Persist the dismissed state to the backend
      const message = messages.find((m) => m.id === messageId);
      const persistedReceipts = [
        ...(message?.actionReceipts ?? []).map((r) =>
          r.id === receiptId ? { ...r, dismissed: true } : r,
        ),
        ...completedReceipts,
      ];
      void persistMessageReceipts(messageId, persistedReceipts);
    },
    [messages],
  );

  const handleCancelWorkflow = useCallback(
    (messageId: string, receiptId: string) => {
      setMessages((prev) =>
        prev.map((item) => {
          if (item.id !== messageId) return item;
          return {
            ...item,
            actionReceipts: (item.actionReceipts ?? []).map((r) =>
              r.id === receiptId ? { ...r, dismissed: true } : r,
            ),
          };
        }),
      );
      const message = messages.find((m) => m.id === messageId);
      const updatedReceipts = (message?.actionReceipts ?? []).map((r) =>
        r.id === receiptId ? { ...r, dismissed: true } : r,
      );
      void persistMessageReceipts(messageId, updatedReceipts);
    },
    [messages],
  );

  const handleSend = useCallback(
    async (text: string, file?: File) => {
      if (file) {
        const result = await readImageAttachment(file);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        await sendMessage(text, result.attachment);
        return;
      }
      await sendMessage(text);
    },
    [sendMessage],
  );

  const handleNewChat = useCallback(
    async (section?: "main" | "side") => {
      const activeThread = threads.find((thread) => thread.id === activeThreadId);
      const targetSection =
        section ?? (activeThread?.section === "side" ? "side" : "main");

      try {
        const id = await createThread(targetSection);
        setConversationId(id);
        setMessages([]);
        setError(null);
        bumpThreads();
      } catch {
        setError("Could not start a new conversation.");
      }
    },
    [activeThreadId, bumpThreads, createThread, threads],
  );

  const handleClear = useCallback(() => {
    void handleNewChat();
  }, [handleNewChat]);

  const handleExtract = useCallback(() => {
    if (messages.length === 0) return;
    const lines = messages.map((message) => {
      const role = message.role === "user" ? "You" : "Assistant";
      return `${role}: ${message.content}`;
    });
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `conversation-${conversationId ?? "export"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [conversationId, messages]);

  if (isInitializing) {
    return <LoadingScreen className="app-root" />;
  }

  return (
    <HomeScreen
      messages={messages}
      isThreadLoading={isThreadLoading}
      error={error}
      disabled={isLoading || isThreadLoading}
      threads={threads}
      activeThreadId={activeThreadId}
      threadsLoading={threadsLoading}
      onSelectThread={switchThread}
      onDeleteThread={(id, title) => void deleteThread(id, title)}
      onNewChat={(section) => void handleNewChat(section)}
      onSend={(text, file) => void handleSend(text, file)}
      onClear={() => void handleClear()}
      onExtract={handleExtract}
      onStreamingComplete={handleStreamingComplete}
      onRetry={() => void loadConversation()}
      onUndoReceipt={(messageId, receiptId) =>
        void handleUndoReceipt(messageId, receiptId)
      }
      onConfirmReceipt={(messageId, receiptId) =>
        void handleConfirmReceipt(messageId, receiptId)
      }
      onDismissReceipt={handleDismissReceipt}
      onApproveWorkflow={handleApproveWorkflow}
      onCancelWorkflow={handleCancelWorkflow}
      confirmBusyReceiptId={confirmBusyReceiptId}
      voiceActive={voice.voiceActive}
      voiceMemoryFlash={voiceMemoryFlash}
      voiceWakeWordMode={voice.wakeWordMode}
      voicePassiveWakeListening={voice.passiveWakeListening}
      voiceWakePhraseLabel={getWakePhraseLabel(voice.preferences.wakePhrases)}
      voiceSessionState={voice.sessionState}
      voiceBargeInActive={voice.bargeInActive}
      voiceInterimTranscript={voice.interimTranscript}
      voiceError={voice.voiceError}
      voiceConversationMode={voice.conversationMode}
      voiceAudioLevel={voice.audioLevel}
      voiceRecordingSeconds={voice.recordingSeconds}
      voiceSettingsOpen={voice.settingsOpen}
      onVoiceSettingsOpen={() => voice.setSettingsOpen(true)}
      onVoiceSettingsClose={() => voice.setSettingsOpen(false)}
      onVoicePreferencesChange={voice.updatePreferences}
      voicePreferences={voice.preferences}
      onVoiceDismissError={() => voice.setVoiceError(null)}
      onVoiceInterrupt={() => voice.interruptAssistant()}
      onVoiceMicTap={() => {
        if (voice.sessionState === "assistant_speaking") {
          voice.bargeInWhileSpeaking();
          return;
        }
        if (voice.sessionState === "assistant_streaming") {
          voice.interruptAssistant();
          return;
        }
        if (voice.wakeWordMode) {
          void voice.toggleWakeWordMode();
          return;
        }
        void voice.toggleConversationMode();
      }}
      onVoiceMicHoldStart={() => voice.startPushToTalk()}
      onVoiceMicHoldEnd={() => voice.endPushToTalk()}
      onAttachmentChange={handleAttachmentChange}
      composerInitialDraft={searchParams.get("prompt") ?? undefined}
    />
  );
}
