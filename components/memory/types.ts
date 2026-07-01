import type { MemoryType } from "@/lib/supabase/types";

export type { MemoryType };
export type MemoryDataType = "all" | "facts" | "workouts" | "reminders";
export type MemoryCategory = "preference" | "fact" | "goal" | "other";

export interface FactItem {
  id: string;
  content: string;
  category: string | null;
  memory_type: MemoryType | null;
  salience: number;
  is_pinned: boolean;
  is_archived: boolean;
  confidence: number;
  valid_from: string | null;
  created_at: string;
}

export interface WorkoutItem {
  id: string;
  exercise: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  duration_min: number | null;
  notes: string | null;
  logged_at: string;
}

export interface ReminderItem {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  created_at: string;
}

export interface MemorySearchResponse {
  query: string;
  facts: FactItem[];
  workouts: WorkoutItem[];
  reminders: ReminderItem[];
}

export const MEMORY_TYPE_FILTERS: { id: MemoryType | "all"; label: string; color: string }[] = [
  { id: "all", label: "All", color: "var(--text-secondary)" },
  { id: "fact", label: "Facts", color: "#3b82f6" },
  { id: "preference", label: "Preferences", color: "#8b5cf6" },
  { id: "routine", label: "Routines", color: "#10b981" },
  { id: "episodic", label: "Episodic", color: "#f59e0b" },
  { id: "goal", label: "Goals", color: "#ef4444" },
  { id: "relationship", label: "People", color: "#ec4899" },
  { id: "skill", label: "Skills", color: "#06b6d4" },
];

export const TYPE_FILTERS: { id: MemoryDataType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "facts", label: "Memories" },
  { id: "workouts", label: "Workouts" },
  { id: "reminders", label: "Reminders" },
];

export const CATEGORY_FILTERS: { id: MemoryCategory | "all"; label: string }[] = [
  { id: "all", label: "All categories" },
  { id: "preference", label: "Preference" },
  { id: "fact", label: "Fact" },
  { id: "goal", label: "Goal" },
  { id: "other", label: "Other" },
];

export const MEMORY_TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: "fact", label: "Fact" },
  { value: "preference", label: "Preference" },
  { value: "routine", label: "Routine" },
  { value: "episodic", label: "Episodic Event" },
  { value: "goal", label: "Goal" },
  { value: "relationship", label: "Person / Relationship" },
  { value: "skill", label: "Skill" },
];

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatWorkoutSummary(workout: WorkoutItem): string {
  const parts = [workout.exercise];
  if (workout.sets != null && workout.reps != null) {
    parts.push(`${workout.sets}x${workout.reps}`);
  }
  if (workout.weight_kg != null) {
    parts.push(`${workout.weight_kg}kg`);
  }
  if (workout.duration_min != null) {
    parts.push(`${workout.duration_min} min`);
  }
  return parts.join(" · ");
}

export function getTypeColor(type: MemoryType | null | undefined): string {
  const found = MEMORY_TYPE_FILTERS.find((f) => f.id === type);
  return found?.color ?? "var(--text-secondary)";
}

export function getTypeLabel(type: MemoryType | null | undefined): string {
  const found = MEMORY_TYPE_FILTERS.find((f) => f.id === type);
  return found?.label ?? "Memory";
}
