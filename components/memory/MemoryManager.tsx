"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/client/fetch";
import {
  Button,
  EmptyState,
  InlineError,
  Notice,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui/primitives";
import { PageShell } from "@/components/shell/PageShell";
import { LoadingScreen } from "@/components/shell/LoadingScreen";
import { FactRow, ReminderRow, WorkoutRow } from "./MemoryItemRow";
import {
  MEMORY_TYPE_FILTERS,
  MEMORY_TYPE_OPTIONS,
  TYPE_FILTERS,
  type FactItem,
  type MemoryCategory,
  type MemoryDataType,
  type MemorySearchResponse,
  type MemoryType,
} from "./types";

type ActiveTab = "memories" | "workouts" | "reminders" | "archive";
type MemoryTypeFilter = MemoryType | "all";

export function MemoryManager() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("memories");
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<MemoryTypeFilter>("all");
  const [showNeedsReview, setShowNeedsReview] = useState(false);

  const [data, setData] = useState<MemorySearchResponse>({
    query: "",
    facts: [],
    workouts: [],
    reminders: [],
  });
  const [archivedFacts, setArchivedFacts] = useState<FactItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [dedupeMessage, setDedupeMessage] = useState<string | null>(null);
  const [isDeduping, setIsDeduping] = useState(false);

  const [newFact, setNewFact] = useState("");
  const [newFactType, setNewFactType] = useState<MemoryType | "">("");
  const [newFactValidFrom, setNewFactValidFrom] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Load data when filters change
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsSearching(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (debouncedQuery) params.set("q", debouncedQuery);

        // Map activeTab to memory search type
        const typeMap: Record<ActiveTab, MemoryDataType | null> = {
          memories: "facts",
          workouts: "workouts",
          reminders: "reminders",
          archive: null,
        };
        const searchType = typeMap[activeTab];
        if (searchType) params.set("type", searchType);
        if (memoryTypeFilter !== "all" && activeTab === "memories") {
          params.set("memory_type", memoryTypeFilter);
        }

        if (activeTab === "archive") {
          const archived = await fetchJson<{ memories: FactItem[] }>(
            `/api/memories?archived=true&limit=50`,
          );
          if (!cancelled) {
            setArchivedFacts(archived.memories ?? []);
            setIsLoading(false);
            setIsSearching(false);
          }
          return;
        }

        const json = await fetchJson<MemorySearchResponse>(
          `/api/memory/search?${params.toString()}`,
        );
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load memory.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsSearching(false);
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [activeTab, debouncedQuery, memoryTypeFilter]);

  async function refreshData() {
    setIsSearching(true);
    setError(null);
    try {
      if (activeTab === "archive") {
        const archived = await fetchJson<{ memories: FactItem[] }>(
          `/api/memories?archived=true&limit=50`,
        );
        setArchivedFacts(archived.memories ?? []);
        return;
      }

      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      const typeMap: Record<ActiveTab, MemoryDataType | null> = {
        memories: "facts", workouts: "workouts", reminders: "reminders", archive: null,
      };
      const searchType = typeMap[activeTab];
      if (searchType) params.set("type", searchType);
      if (memoryTypeFilter !== "all" && activeTab === "memories") {
        params.set("memory_type", memoryTypeFilter);
      }
      const json = await fetchJson<MemorySearchResponse>(`/api/memory/search?${params.toString()}`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load memory.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleCreateFact(e: React.FormEvent) {
    e.preventDefault();
    const content = newFact.trim();
    if (!content) return;

    setIsCreating(true);
    setCreateMessage(null);
    setActionMessage(null);
    setError(null);
    try {
      const body: Record<string, unknown> = { content };
      if (newFactType) body.memory_type = newFactType;
      if (newFactValidFrom && newFactType === "episodic") {
        body.valid_from = new Date(newFactValidFrom).toISOString();
      }

      const json = await fetchJson<{ action?: string }>("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setNewFact("");
      setNewFactType("");
      setNewFactValidFrom("");
      setCreateMessage(
        json.action === "merged" || json.action === "replaced"
          ? `Saved (${json.action} with existing memory)`
          : json.action === "unchanged"
            ? "Already saved"
            : "Memory added",
      );
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add memory.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDedupe() {
    setIsDeduping(true);
    setDedupeMessage(null);
    setActionMessage(null);
    setError(null);
    try {
      const json = await fetchJson<{ removed: number }>("/api/memories/dedupe", {
        method: "POST",
      });
      setDedupeMessage(
        json.removed > 0
          ? `Removed ${json.removed} duplicate(s)`
          : "No duplicates found",
      );
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dedupe memories.");
    } finally {
      setIsDeduping(false);
    }
  }

  async function handleSaveFact(
    id: string,
    content: string,
    category: MemoryCategory | "",
    memoryType: MemoryType | "",
  ) {
    setBusyId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          category: category || undefined,
          memory_type: memoryType || undefined,
        }),
      });
      await refreshData();
      setActionMessage("Memory saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update memory.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteFact(id: string) {
    if (!window.confirm("Delete this memory permanently?")) return;
    setBusyId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/memories/${id}`, { method: "DELETE" });
      await refreshData();
      setActionMessage("Memory deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete memory.");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePin(id: string, pinned: boolean) {
    setBusyId(id);
    try {
      await fetchJson(`/api/memories/${id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      await refreshData();
      setActionMessage(pinned ? "Memory pinned." : "Memory unpinned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update pin.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleArchive(id: string) {
    if (!window.confirm("Archive this memory? It will be hidden from retrieval but not deleted.")) return;
    setBusyId(id);
    try {
      await fetchJson(`/api/memories/${id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      await refreshData();
      setActionMessage("Memory archived.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive memory.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnarchive(id: string) {
    setBusyId(id);
    try {
      await fetchJson(`/api/memories/${id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      setArchivedFacts((prev) => prev.filter((f) => f.id !== id));
      setActionMessage("Memory restored.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore memory.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveWorkout(id: string, fields: Record<string, string | number | null | undefined>) {
    setBusyId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/workouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      await refreshData();
      setActionMessage("Workout saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update workout.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteWorkout(id: string) {
    if (!window.confirm("Delete this workout?")) return;
    setBusyId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/workouts/${id}`, { method: "DELETE" });
      await refreshData();
      setActionMessage("Workout deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete workout.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveReminder(
    id: string,
    fields: { title: string; due_at: string | null; status: string },
  ) {
    setBusyId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, forMemory: true }),
      });
      await refreshData();
      setActionMessage("Reminder saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update reminder.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteReminder(id: string) {
    if (!window.confirm("Delete this reminder permanently?")) return;
    setBusyId(id);
    setError(null);
    setActionMessage(null);
    try {
      await fetchJson(`/api/reminders/${id}`, { method: "DELETE" });
      await refreshData();
      setActionMessage("Reminder deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete reminder.");
    } finally {
      setBusyId(null);
    }
  }

  // Apply local filters
  let displayedFacts = data.facts;
  if (showNeedsReview) {
    displayedFacts = displayedFacts.filter((f) => f.confidence < 0.7);
  }

  const hasResults =
    activeTab === "memories"
      ? displayedFacts.length > 0
      : activeTab === "workouts"
        ? data.workouts.length > 0
        : activeTab === "reminders"
          ? data.reminders.length > 0
          : archivedFacts.length > 0;

  const needsReviewCount = data.facts.filter((f) => f.confidence < 0.7).length;

  if (isLoading) {
    return (
      <PageShell title="Memory">
        <LoadingScreen />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Memory"
      subtitle="Your knowledge base — the assistant's understanding of you"
    >
      {/* Search bar */}
      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Semantic search across all memories..."
            className="flex-1 px-4 py-2.5"
          />
          {query ? (
            <Button type="button" onClick={() => setQuery("")} variant="secondary" className="px-3 py-2 text-sm">
              Clear
            </Button>
          ) : null}
        </div>

        {/* Main tab bar */}
        <div className="flex gap-1 border-b border-[var(--border)]">
          {(["memories", "workouts", "reminders", "archive"] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setMemoryTypeFilter("all");
                setShowNeedsReview(false);
              }}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition -mb-px ${
                activeTab === tab
                  ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                  : "border-transparent ui-muted hover:text-[var(--text-primary)]"
              }`}
            >
              {tab === "memories" ? "Memories" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "memories" && data.facts.length > 0 && (
                <span className="ml-1.5 text-xs ui-muted">({data.facts.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Memory type pills — only shown on memories tab */}
        {activeTab === "memories" && (
          <div className="flex flex-wrap gap-1.5">
            {MEMORY_TYPE_FILTERS.map((filter) => {
              const count = filter.id === "all"
                ? data.facts.length
                : data.facts.filter((f) => f.memory_type === filter.id).length;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setMemoryTypeFilter(filter.id as MemoryTypeFilter)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
                    memoryTypeFilter === filter.id
                      ? "ui-button-primary"
                      : "ui-button-secondary"
                  }`}
                  style={
                    memoryTypeFilter === filter.id && filter.id !== "all"
                      ? { backgroundColor: `${filter.color}22`, color: filter.color, borderColor: `${filter.color}66` }
                      : undefined
                  }
                >
                  {filter.label}
                  {count > 0 && (
                    <span className="opacity-60">{count}</span>
                  )}
                </button>
              );
            })}

            {needsReviewCount > 0 && (
              <button
                type="button"
                onClick={() => setShowNeedsReview((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  showNeedsReview
                    ? "bg-[var(--status-warning)] text-white"
                    : "ui-button-secondary text-[var(--status-warning)]"
                }`}
              >
                Needs review ({needsReviewCount})
              </button>
            )}
          </div>
        )}

        {isSearching && <p className="ui-muted text-xs">Searching...</p>}
      </div>

      {error && (
        <InlineError
          message={error}
          className="mb-4"
          actions={
            <>
              <Button type="button" onClick={() => void refreshData()} variant="secondary" className="px-3 py-1.5 text-xs">
                Retry
              </Button>
              <Button type="button" onClick={() => setError(null)} variant="ghost" className="px-3 py-1.5 text-xs">
                Dismiss
              </Button>
            </>
          }
        />
      )}

      {/* Add memory form — shown on memories and archive tabs */}
      {(activeTab === "memories" || activeTab === "archive") && (
        <form onSubmit={handleCreateFact} className="ui-surface mb-6 p-4">
          <h2 className="mb-2 text-sm font-medium">Add a memory</h2>
          <TextArea
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            rows={2}
            placeholder="Something worth remembering..."
            className="mb-2"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={newFactType}
              onChange={(e) => setNewFactType(e.target.value as MemoryType | "")}
              className="max-w-[180px]"
            >
              <option value="">Auto-detect type</option>
              {MEMORY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
            {newFactType === "episodic" && (
              <TextInput
                type="date"
                value={newFactValidFrom}
                onChange={(e) => setNewFactValidFrom(e.target.value)}
                className="max-w-[160px]"
                placeholder="When did this happen?"
              />
            )}
            <Button type="submit" disabled={isCreating || !newFact.trim()}>
              {isCreating ? "Saving..." : "Add memory"}
            </Button>
            <Button type="button" disabled={isDeduping} onClick={handleDedupe} variant="secondary">
              {isDeduping ? "Cleaning..." : "Clean duplicates"}
            </Button>
          </div>
          {createMessage && <Notice tone="success" className="mt-2 text-xs">{createMessage}</Notice>}
          {dedupeMessage && <Notice tone="neutral" className="mt-2 text-xs">{dedupeMessage}</Notice>}
          {actionMessage && <Notice tone="success" className="mt-2 text-xs">{actionMessage}</Notice>}
        </form>
      )}

      {!hasResults && (
        <EmptyState
          title={
            activeTab === "archive"
              ? "No archived memories"
              : debouncedQuery
                ? `No matches for "${debouncedQuery}"`
                : "Nothing here yet"
          }
          detail={
            activeTab === "archive"
              ? "Memories archived by you or by the decay cycle appear here."
              : debouncedQuery
                ? "Try different keywords or clear the search."
                : "Chat naturally — the assistant will store key details about you."
          }
        />
      )}

      {/* Memories tab */}
      {activeTab === "memories" && displayedFacts.length > 0 && (
        <section>
          <div className="space-y-2">
            {displayedFacts.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                busy={busyId === fact.id}
                onSave={handleSaveFact}
                onDelete={handleDeleteFact}
                onPin={handlePin}
                onArchive={handleArchive}
              />
            ))}
          </div>
        </section>
      )}

      {/* Workouts tab */}
      {activeTab === "workouts" && data.workouts.length > 0 && (
        <section>
          <div className="space-y-2">
            {data.workouts.map((workout) => (
              <WorkoutRow
                key={workout.id}
                workout={workout}
                busy={busyId === workout.id}
                onSave={handleSaveWorkout}
                onDelete={handleDeleteWorkout}
              />
            ))}
          </div>
        </section>
      )}

      {/* Reminders tab */}
      {activeTab === "reminders" && data.reminders.length > 0 && (
        <section>
          <div className="space-y-2">
            {data.reminders.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                busy={busyId === reminder.id}
                onSave={handleSaveReminder}
                onDelete={handleDeleteReminder}
              />
            ))}
          </div>
        </section>
      )}

      {/* Archive tab */}
      {activeTab === "archive" && archivedFacts.length > 0 && (
        <section>
          <p className="ui-muted text-xs mb-3">
            Archived memories are excluded from chat retrieval. Restore to make them active again.
          </p>
          <div className="space-y-2">
            {archivedFacts.map((fact) => (
              <div key={fact.id} className="ui-surface px-4 py-3 opacity-70">
                <p className="text-sm whitespace-pre-wrap">{fact.content}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="ui-muted text-xs">
                    {fact.memory_type ?? "memory"} · archived
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={busyId === fact.id}
                      onClick={() => handleUnarchive(fact.id)}
                      variant="secondary"
                      className="text-xs"
                    >
                      Restore
                    </Button>
                    <Button
                      type="button"
                      disabled={busyId === fact.id}
                      onClick={() => handleDeleteFact(fact.id)}
                      variant="ghost"
                      className="text-xs text-[var(--status-error)]"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
