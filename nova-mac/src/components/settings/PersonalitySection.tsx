import { useEffect, useState } from "react";
import { nova } from "../../lib/ipc";
import type { PersonalityTrait } from "@shared/types";

// Learned personality traits: Nova saves these automatically when you give it
// style feedback mid-conversation ("swear less", "more banter"); this section
// lets you review, edit, and delete what it has learned.

export function PersonalitySection({
  Group,
}: {
  Group: (p: { children: React.ReactNode }) => React.ReactElement;
}) {
  const [traits, setTraits] = useState<PersonalityTrait[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newTrait, setNewTrait] = useState("");

  function refresh() {
    nova().personalityList().then(setTraits).catch(() => {});
  }
  useEffect(refresh, []);

  async function commit(t: PersonalityTrait) {
    const text = drafts[t.id];
    if (text === undefined || text.trim() === t.text) return;
    if (text.trim()) await nova().personalityUpdate({ id: t.id, text: text.trim() });
    setDrafts((d) => {
      const { [t.id]: _, ...rest } = d;
      return rest;
    });
    refresh();
  }

  async function add() {
    const text = newTrait.trim();
    if (!text) return;
    await nova().personalityAdd(text);
    setNewTrait("");
    refresh();
  }

  const inputCls =
    "flex-1 min-w-0 rounded-full border border-white/[0.06] bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] text-[--nova-text] outline-none focus:border-white/[0.16]";

  return (
    <>
      <Group>
        <div className="px-5 py-4">
          <div className="text-[13.5px] font-medium text-[--nova-text]">How Nova evolves</div>
          <div className="text-[12px] leading-relaxed text-[--nova-text-secondary] mt-1">
            Tell Nova how to talk — “swear less”, “more banter”, “stop calling me boss” — and it
            saves the feedback here as a permanent trait that shapes every future conversation.
            Edit or delete anything it picked up wrong.
          </div>
        </div>
      </Group>

      <div className="mt-3">
        <Group>
          {traits.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 px-5 py-3">
              <input
                className={inputCls}
                value={drafts[t.id] ?? t.text}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                onBlur={() => void commit(t)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <span className="text-[10.5px] uppercase tracking-wider text-[--nova-text-secondary]/60 flex-shrink-0">
                {t.source === "chat" ? "learned" : "manual"}
              </span>
              <button
                onClick={() => void nova().personalityDelete(t.id).then(refresh)}
                title="Delete trait"
                className="rounded-full border border-red-400/20 bg-red-500/[0.08] px-3 py-1 text-[11.5px] text-red-300/90 hover:bg-red-500/[0.15] transition-colors flex-shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2.5 px-5 py-3">
            <input
              className={inputCls}
              placeholder="Add a trait yourself (e.g. “Call me Ary”, “Keep replies short”)"
              value={newTrait}
              onChange={(e) => setNewTrait(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <button
              onClick={() => void add()}
              disabled={!newTrait.trim()}
              className="rounded-full bg-[--nova-accent] px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40 transition-opacity flex-shrink-0"
            >
              Add
            </button>
          </div>
        </Group>
      </div>

      {traits.length === 0 && (
        <p className="mt-4 px-2 text-[12px] text-[--nova-text-secondary]">
          Nothing learned yet — give Nova feedback in conversation and it'll show up here.
        </p>
      )}
    </>
  );
}
