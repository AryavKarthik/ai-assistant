import { useEffect, useRef, useState } from "react";
import { nova } from "../lib/ipc";
import type { MemoryItem } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

const TYPE_COLORS: Record<string, string> = {
  fact: "bg-blue-500/20 text-blue-300",
  preference: "bg-purple-500/20 text-purple-300",
  routine: "bg-green-500/20 text-green-300",
  episodic: "bg-amber-500/20 text-amber-300",
  goal: "bg-rose-500/20 text-rose-300",
  relationship: "bg-pink-500/20 text-pink-300",
  skill: "bg-cyan-500/20 text-cyan-300",
};

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(q: string) {
    setLoading(true);
    try {
      const data = await nova().memorySearch({ query: q });
      setMemories(data as MemoryItem[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(""); }, []);

  function onQueryChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(q), 300);
  }

  async function pin(id: string, pinned: boolean) {
    await nova().memoryPin({ id, pinned });
    setMemories((ms) => ms.map((m) => m.id === id ? { ...m, isPinned: pinned } : m));
  }

  async function remove(id: string) {
    await nova().memoryDelete(id);
    setMemories((ms) => ms.filter((m) => m.id !== id));
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-4">
      <h1 className="text-lg font-semibold text-[--nova-text]">Memory</h1>

      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search memories…"
        className="w-full rounded-xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm text-[--nova-text] placeholder:text-[--nova-text-secondary] outline-none focus:ring-2 focus:ring-[--nova-accent]/40"
      />

      {loading ? (
        <div className="text-sm text-center text-[--nova-text-secondary]">Loading…</div>
      ) : memories.length === 0 ? (
        <div className="text-sm text-center text-[--nova-text-secondary]">No memories found</div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <Card key={m.id} className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {m.memoryType && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${TYPE_COLORS[m.memoryType] ?? "bg-white/10 text-white/60"}`}>
                      {m.memoryType}
                    </span>
                  )}
                  {m.isPinned && <span className="text-xs text-amber-400">📌</span>}
                </div>
                <p className="text-sm text-[--nova-text] leading-relaxed">{m.content}</p>
                <p className="text-xs text-[--nova-text-secondary] mt-1">
                  Salience {(m.salience * 100).toFixed(0)}%
                </p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={() => void pin(m.id, !m.isPinned)}>
                  {m.isPinned ? "Unpin" : "Pin"}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(m.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
