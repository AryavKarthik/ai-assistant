"use client";

import { useState } from "react";
import { Button, Select, TextArea, TextInput } from "@/components/ui/primitives";
import type {
  FactItem,
  MemoryCategory,
  ReminderItem,
  WorkoutItem,
} from "./types";
import {
  formatDate,
  formatShortDate,
  formatWorkoutSummary,
  getTypeColor,
  getTypeLabel,
  MEMORY_TYPE_OPTIONS,
} from "./types";
import type { MemoryType } from "@/lib/supabase/types";

interface FactRowProps {
  fact: FactItem;
  busy: boolean;
  onSave: (id: string, content: string, category: MemoryCategory | "", memoryType: MemoryType | "") => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}

function SalienceBar({ salience }: { salience: number }) {
  const pct = Math.round(salience * 100);
  const color =
    salience >= 0.75
      ? "var(--status-success)"
      : salience >= 0.5
        ? "var(--text-secondary)"
        : "var(--status-warning)";

  return (
    <div
      title={`Salience: ${pct}%`}
      className="flex items-center gap-1"
    >
      <div
        className="h-1 rounded-full"
        style={{
          width: `${Math.max(4, pct * 0.4)}px`,
          backgroundColor: color,
          opacity: 0.6,
        }}
      />
    </div>
  );
}

function TypeBadge({ type }: { type: MemoryType | null | undefined }) {
  if (!type) return null;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{
        backgroundColor: `${getTypeColor(type)}22`,
        color: getTypeColor(type),
        border: `1px solid ${getTypeColor(type)}44`,
      }}
    >
      {getTypeLabel(type)}
    </span>
  );
}

export function FactRow({ fact, busy, onSave, onDelete, onPin, onArchive }: FactRowProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(fact.content);
  const [category, setCategory] = useState(fact.category ?? "");
  const [memoryType, setMemoryType] = useState<MemoryType | "">(fact.memory_type ?? "");

  async function handleSave() {
    await onSave(fact.id, content, category as MemoryCategory | "", memoryType);
    setEditing(false);
  }

  const isLowConfidence = fact.confidence < 0.7;

  return (
    <div className={`ui-surface px-4 py-3 ${fact.is_pinned ? "ring-1 ring-[var(--status-info)]" : ""}`}>
      {editing ? (
        <div className="space-y-2">
          <TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
          />
          <Select
            value={memoryType}
            onChange={(e) => setMemoryType(e.target.value as MemoryType | "")}
            className="max-w-xs"
          >
            <option value="">Auto-detect type</option>
            {MEMORY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="max-w-xs"
          >
            <option value="">No category</option>
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
            <option value="goal">Goal</option>
            <option value="other">Other</option>
          </Select>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={handleSave} className="px-3 py-1.5 text-xs">
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setContent(fact.content);
                setCategory(fact.category ?? "");
                setMemoryType(fact.memory_type ?? "");
                setEditing(false);
              }}
              variant="secondary"
              className="px-3 py-1.5 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm whitespace-pre-wrap flex-1">{fact.content}</p>
            {fact.is_pinned && (
              <span className="text-xs" title="Pinned">📌</span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <TypeBadge type={fact.memory_type} />
              <SalienceBar salience={fact.salience} />
              {fact.memory_type === "episodic" && fact.valid_from && (
                <span className="ui-muted text-xs">{formatShortDate(fact.valid_from)}</span>
              )}
              {isLowConfidence && (
                <span className="text-[10px] text-[var(--status-warning)] border border-[var(--status-warning)] rounded px-1">
                  needs review
                </span>
              )}
              <span className="ui-muted text-xs">{formatDate(fact.created_at)}</span>
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                disabled={busy}
                onClick={() => onPin(fact.id, !fact.is_pinned)}
                variant="ghost"
                className="text-xs"
                title={fact.is_pinned ? "Unpin" : "Pin"}
              >
                {fact.is_pinned ? "Unpin" : "Pin"}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                variant="ghost"
                className="text-xs"
              >
                Edit
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => onArchive(fact.id)}
                variant="ghost"
                className="text-xs"
                title="Archive"
              >
                Archive
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => onDelete(fact.id)}
                variant="ghost"
                className="text-xs text-[var(--status-error)]"
              >
                {busy ? "..." : "Delete"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface WorkoutRowProps {
  workout: WorkoutItem;
  busy: boolean;
  onSave: (id: string, data: Partial<WorkoutItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function WorkoutRow({ workout, busy, onSave, onDelete }: WorkoutRowProps) {
  const [editing, setEditing] = useState(false);
  const [exercise, setExercise] = useState(workout.exercise);
  const [sets, setSets] = useState(workout.sets?.toString() ?? "");
  const [reps, setReps] = useState(workout.reps?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(workout.weight_kg?.toString() ?? "");
  const [notes, setNotes] = useState(workout.notes ?? "");

  async function handleSave() {
    await onSave(workout.id, {
      exercise,
      sets: sets ? Number(sets) : null,
      reps: reps ? Number(reps) : null,
      weight_kg: weightKg ? Number(weightKg) : null,
      notes: notes || null,
    });
    setEditing(false);
  }

  return (
    <div className="ui-surface px-4 py-3">
      {editing ? (
        <div className="space-y-2">
          <TextInput value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Exercise" />
          <div className="grid grid-cols-3 gap-2">
            <TextInput value={sets} onChange={(e) => setSets(e.target.value)} placeholder="Sets" />
            <TextInput value={reps} onChange={(e) => setReps(e.target.value)} placeholder="Reps" />
            <TextInput value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="kg" />
          </div>
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={handleSave} className="px-3 py-1.5 text-xs">
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button type="button" onClick={() => setEditing(false)} variant="secondary" className="px-3 py-1.5 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">{formatWorkoutSummary(workout)}</p>
          {workout.notes && (
            <p className="ui-text-secondary mt-1 text-sm">{workout.notes}</p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="ui-muted text-xs">{formatDate(workout.logged_at)}</div>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => setEditing(true)} variant="ghost" className="text-xs">
                Edit
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => onDelete(workout.id)}
                variant="ghost"
                className="text-xs text-[var(--status-error)]"
              >
                {busy ? "..." : "Delete"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface ReminderRowProps {
  reminder: ReminderItem;
  busy: boolean;
  onSave: (id: string, data: { title: string; due_at: string | null; status: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ReminderRow({ reminder, busy, onSave, onDelete }: ReminderRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(reminder.title);
  const [dueAt, setDueAt] = useState(reminder.due_at ? reminder.due_at.slice(0, 16) : "");
  const [status, setStatus] = useState(reminder.status);

  async function handleSave() {
    await onSave(reminder.id, {
      title,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      status,
    });
    setEditing(false);
  }

  return (
    <div className="ui-surface px-4 py-3">
      {editing ? (
        <div className="space-y-2">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextInput type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs">
            <option value="pending">Pending</option>
            <option value="done">Done</option>
          </Select>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={handleSave} className="px-3 py-1.5 text-xs">
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button type="button" onClick={() => setEditing(false)} variant="secondary" className="px-3 py-1.5 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">{reminder.title}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="ui-muted text-xs">
              {reminder.status} · {reminder.due_at ? formatDate(reminder.due_at) : "No due date"}
            </div>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => setEditing(true)} variant="ghost" className="text-xs">
                Edit
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => onDelete(reminder.id)}
                variant="ghost"
                className="text-xs text-[var(--status-error)]"
              >
                {busy ? "..." : "Delete"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
