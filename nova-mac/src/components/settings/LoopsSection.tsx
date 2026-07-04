import { useEffect, useState } from "react";
import { nova } from "../../lib/ipc";
import type { AgentLoop, LoopSchedule, LoopUpsertRequest } from "@shared/types";
import { cn } from "../../lib/utils";
import { Select } from "../ui/Select";

// Agent loops management: scheduled natural-language tasks Nova runs
// autonomously (full tool access) and announces the result of.

function describeSchedule(s: LoopSchedule): string {
  switch (s.kind) {
    case "once": {
      const at = new Date(s.at);
      return Number.isNaN(at.getTime()) ? "once" : `once · ${at.toLocaleString()}`;
    }
    case "daily":
      return `daily · ${s.timeLocal}`;
    case "interval":
      return `every ${s.everyMinutes} min`;
  }
}

/** datetime-local wants "YYYY-MM-DDTHH:MM" in local time. */
function toLocalInputValue(iso: string): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Draft {
  id?: string;
  name: string;
  instruction: string;
  kind: LoopSchedule["kind"];
  at: string; // datetime-local value
  timeLocal: string;
  everyMinutes: number;
  speakResult: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  instruction: "",
  kind: "once",
  at: toLocalInputValue(""),
  timeLocal: "08:00",
  everyMinutes: 60,
  speakResult: true,
};

const inputCls =
  "rounded-full border border-white/[0.06] bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] text-[--nova-text] outline-none focus:border-white/[0.16] w-full";

export function LoopsSection({
  Toggle,
  Group,
  Row,
}: {
  Toggle: (p: { value: boolean; onChange: (v: boolean) => void }) => React.ReactElement;
  Group: (p: { children: React.ReactNode }) => React.ReactElement;
  Row: (p: { label: string; description?: string; children?: React.ReactNode }) => React.ReactElement;
}) {
  const [loops, setLoops] = useState<AgentLoop[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    nova().loopsList().then(setLoops).catch(() => {});
  }
  useEffect(refresh, []);

  async function saveDraft() {
    if (!draft || !draft.instruction.trim()) return;
    let schedule: LoopSchedule;
    if (draft.kind === "once") {
      const at = new Date(draft.at);
      if (Number.isNaN(at.getTime())) {
        setError("Pick a valid date/time.");
        return;
      }
      schedule = { kind: "once", at: at.toISOString() };
    } else if (draft.kind === "daily") {
      schedule = { kind: "daily", timeLocal: draft.timeLocal };
    } else {
      schedule = { kind: "interval", everyMinutes: Math.max(1, draft.everyMinutes) };
    }
    const req: LoopUpsertRequest = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim() || "Untitled loop",
      instruction: draft.instruction.trim(),
      schedule,
      enabled: true,
      speakResult: draft.speakResult,
    };
    try {
      await nova().loopsUpsert(req);
      setDraft(null);
      setError(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save loop");
    }
  }

  async function runNow(loop: AgentLoop) {
    setBusyId(loop.id);
    try {
      await nova().loopsRunNow(loop.id);
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  function edit(loop: AgentLoop) {
    setDraft({
      id: loop.id,
      name: loop.name,
      instruction: loop.instruction,
      kind: loop.schedule.kind,
      at: loop.schedule.kind === "once" ? toLocalInputValue(loop.schedule.at) : toLocalInputValue(""),
      timeLocal: loop.schedule.kind === "daily" ? loop.schedule.timeLocal : "08:00",
      everyMinutes: loop.schedule.kind === "interval" ? loop.schedule.everyMinutes : 60,
      speakResult: loop.speakResult,
    });
  }

  return (
    <>
      <Group>
        <Row
          label="Agentic loops"
          description="Tasks Nova runs on its own — on a schedule, with full tool access (email, calendar, Mac control). Results are announced out loud. You can also just ask by voice: “email me at 10:30 with…”."
        >
          <button
            onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT, at: toLocalInputValue("") })}
            className="rounded-full border border-white/[0.08] bg-white/[0.07] px-4 py-1.5 text-[12.5px] font-medium text-[--nova-text] hover:bg-white/[0.12] transition-colors"
          >
            {draft && !draft.id ? "Close" : "New loop"}
          </button>
        </Row>
      </Group>

      {draft && (
        <div className="mt-3 rounded-[22px] border border-white/[0.05] bg-white/[0.035] p-5 space-y-3">
          <input
            className={inputCls}
            placeholder="Name (e.g. Morning brief)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <textarea
            className="w-full rounded-[16px] border border-white/[0.06] bg-white/[0.06] px-3.5 py-2.5 text-[12.5px] text-[--nova-text] outline-none focus:border-white/[0.16] resize-none"
            rows={3}
            placeholder="What should Nova do? Write it fully — nobody's around to clarify when it runs. (e.g. “Check my calendar and Gmail and give me a quick brief of the day.”)"
            value={draft.instruction}
            onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
          />
          <div className="flex items-center gap-2.5 flex-wrap">
            <Select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}
              className="w-32"
            >
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="interval">Every N min</option>
            </Select>
            {draft.kind === "once" && (
              <input
                type="datetime-local"
                className={cn(inputCls, "w-auto")}
                value={draft.at}
                onChange={(e) => setDraft({ ...draft, at: e.target.value })}
              />
            )}
            {draft.kind === "daily" && (
              <input
                type="time"
                className={cn(inputCls, "w-auto")}
                value={draft.timeLocal}
                onChange={(e) => setDraft({ ...draft, timeLocal: e.target.value })}
              />
            )}
            {draft.kind === "interval" && (
              <input
                type="number"
                min={1}
                className={cn(inputCls, "w-24")}
                value={draft.everyMinutes}
                onChange={(e) => setDraft({ ...draft, everyMinutes: Number(e.target.value) })}
              />
            )}
            <label className="flex items-center gap-2 text-[12px] text-[--nova-text-secondary] ml-auto">
              Speak result
              <Toggle
                value={draft.speakResult}
                onChange={(v) => setDraft({ ...draft, speakResult: v })}
              />
            </label>
          </div>
          {error && <div className="text-[12px] text-red-300">{error}</div>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="rounded-full px-4 py-1.5 text-[12.5px] text-[--nova-text-secondary] hover:text-[--nova-text] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveDraft()}
              disabled={!draft.instruction.trim()}
              className="rounded-full bg-[--nova-accent] px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40 transition-opacity"
            >
              {draft.id ? "Save changes" : "Create loop"}
            </button>
          </div>
        </div>
      )}

      {loops.length > 0 && (
        <div className="mt-3">
          <Group>
            {loops.map((loop) => (
              <div key={loop.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-[--nova-text] truncate">
                      {loop.name}
                      <span className="ml-2 text-[11px] font-normal text-[--nova-text-secondary]">
                        {describeSchedule(loop.schedule)}
                      </span>
                    </div>
                    <div className="text-[12px] text-[--nova-text-secondary] mt-0.5 truncate">
                      {loop.instruction}
                    </div>
                    {loop.lastResult && (
                      <div className="text-[11.5px] text-[--nova-text-secondary]/80 mt-1 line-clamp-2">
                        Last run: {loop.lastResult}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Toggle
                      value={loop.enabled}
                      onChange={(v) =>
                        void nova()
                          .loopsUpsert({
                            id: loop.id,
                            name: loop.name,
                            instruction: loop.instruction,
                            schedule: loop.schedule,
                            enabled: v,
                            speakResult: loop.speakResult,
                          })
                          .then(refresh)
                      }
                    />
                    <button
                      onClick={() => void runNow(loop)}
                      disabled={busyId === loop.id}
                      className="rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1 text-[11.5px] text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/[0.1] disabled:opacity-40 transition-colors"
                    >
                      {busyId === loop.id ? "Running…" : "Run now"}
                    </button>
                    <button
                      onClick={() => edit(loop)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1 text-[11.5px] text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/[0.1] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void nova().loopsDelete(loop.id).then(refresh)}
                      className="rounded-full border border-red-400/20 bg-red-500/[0.08] px-3 py-1 text-[11.5px] text-red-300/90 hover:bg-red-500/[0.15] transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </Group>
        </div>
      )}

      {loops.length === 0 && !draft && (
        <p className="mt-4 px-2 text-[12px] text-[--nova-text-secondary]">
          No loops yet. Create one here, or just tell Nova: “every morning at 8, check my calendar
          and brief me”.
        </p>
      )}
    </>
  );
}
