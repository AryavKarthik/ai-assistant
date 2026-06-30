export type MessageRole = "user" | "assistant";
export type ReminderStatus = "pending" | "done" | "cancelled";
export type MemoryCategory = "preference" | "fact" | "goal" | "other";
export type MemoryType =
  | "fact" | "preference" | "routine" | "episodic"
  | "goal" | "relationship" | "skill";
export type MemorySourceType = "auto_capture" | "tool_save" | "user_manual";
export type LinkType = "related" | "contradicts" | "refines" | "context_of" | "part_of";

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  category: string | null;
  memory_type: MemoryType | null;
  salience: number;
  last_accessed_at: string | null;
  access_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  source_type: MemorySourceType | null;
  valid_from: string | null;
  valid_until: string | null;
  confidence: number;
  metadata: Record<string, unknown> | null;
  source_message_id: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  due_at: string | null;
  status: ReminderStatus;
  completed_at: string | null;
  notified_at: string | null;
  notification_channel: string | null;
  source_message_id: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  logged_at: string;
  exercise: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  duration_min: number | null;
  notes: string | null;
  source_message_id: string | null;
}

export interface MemoryLink {
  id: string;
  user_id: string;
  from_memory_id: string;
  to_memory_id: string;
  link_type: LinkType;
  created_at: string;
}

export interface ChatActionReceipt {
  id: string;
  action: string;
  outcome: string;
  source: string;
  status: "success" | "error";
}
