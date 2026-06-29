export interface ChatImageAttachment {
  mediaType: string;
  data: string;
  previewUrl: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  modelUsed?: string;
  hasImage?: boolean;
  imagePreviewUrl?: string;
  isPending?: boolean;
  isStreaming?: boolean;
  trustTags?: string[];
  actionReceipts?: ChatActionReceipt[];
  highlightStored?: boolean;
}

export interface ChatActionUndo {
  type: "delete_memory" | "restore_reminder_pending";
  targetId: string;
}

export interface ChatActionConfirm {
  type: "send_gmail_draft";
  draftId: string;
  to: string;
  subject: string;
  preview?: string;
}

export interface ChatActionReceipt {
  id: string;
  action: string;
  outcome: string;
  source: "temporary" | "memory" | "gmail" | "calendar" | "youtube" | "reminders";
  status: "success" | "error" | "info";
  undo?: ChatActionUndo;
  confirm?: ChatActionConfirm;
  dismissed?: boolean;
}

export interface ThreadItem {
  id: string;
  title: string;
  updatedAt: string;
  isActive: boolean;
  section?: "main" | "side";
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}
