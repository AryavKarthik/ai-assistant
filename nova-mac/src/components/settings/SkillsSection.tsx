import { useEffect, useState } from "react";
import { nova } from "../../lib/ipc";
import type { CustomSkill, SkillAction } from "@shared/types";
import { Select } from "../ui/Select";

type ActionType = SkillAction["type"];

interface DraftAction {
  type: ActionType;
  path: string;
  app_name: string;
  url: string;
  name: string;
  input: string;
}

interface DraftSkill {
  id?: string;
  name: string;
  triggersText: string;
  enabled: boolean;
  actions: DraftAction[];
}

const EMPTY_ACTION: DraftAction = {
  type: "open_path",
  path: "",
  app_name: "",
  url: "",
  name: "",
  input: "",
};

const EMPTY_DRAFT: DraftSkill = {
  name: "",
  triggersText: "",
  enabled: true,
  actions: [{ ...EMPTY_ACTION }],
};

// Electron's type augmentation declares File.path as a required string, so an
// interface extension with `path?` conflicts; an intersection stays compatible
// with both the DOM lib (no path) and Electron's augmented File.
type FileWithOptionalPath = File & { path?: string };

function decodeFileUri(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith("file://")) return null;
  try {
    const url = new URL(trimmed);
    if (!url.pathname) return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function parseDownloadUrl(input: string): string | null {
  // Chromium DownloadURL format: "<mime>:<filename>:<url>"
  const parts = input.split(":");
  if (parts.length < 3) return null;
  const url = parts.slice(2).join(":");
  return decodeFileUri(url);
}

function actionToDraft(action: SkillAction): DraftAction {
  return {
    type: action.type,
    path: action.type === "open_path" ? action.path : "",
    app_name: action.type === "open_app" ? action.app_name : "",
    url: action.type === "open_url" ? action.url : "",
    name: action.type === "run_shortcut" ? action.name : "",
    input: action.type === "run_shortcut" ? action.input ?? "" : "",
  };
}

function toSkillAction(a: DraftAction): SkillAction | null {
  if (a.type === "open_path" && a.path.trim()) return { type: "open_path", path: a.path.trim() };
  if (a.type === "open_app" && a.app_name.trim()) return { type: "open_app", app_name: a.app_name.trim() };
  if (a.type === "open_url" && a.url.trim()) return { type: "open_url", url: a.url.trim() };
  if (a.type === "run_shortcut" && a.name.trim()) {
    return { type: "run_shortcut", name: a.name.trim(), ...(a.input.trim() ? { input: a.input.trim() } : {}) };
  }
  return null;
}

function decode(skill: CustomSkill): DraftSkill {
  return {
    id: skill.id,
    name: skill.name,
    triggersText: skill.triggers.join(", "),
    enabled: skill.enabled,
    actions: skill.actions.map(actionToDraft),
  };
}

export function SkillsSection({
  Toggle,
  Group,
}: {
  Toggle: (p: { value: boolean; onChange: (v: boolean) => void }) => React.ReactElement;
  Group: (p: { children: React.ReactNode }) => React.ReactElement;
}) {
  const [skills, setSkills] = useState<CustomSkill[]>([]);
  const [draft, setDraft] = useState<DraftSkill | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uiHint, setUiHint] = useState<string | null>(null);

  function refresh() {
    nova().skillsList().then(setSkills).catch(() => {});
  }
  useEffect(refresh, []);

  function firstDroppedPath(e: React.DragEvent): string | null {
    const items = Array.from(e.dataTransfer.items ?? []);
    for (const item of items) {
      const maybeFile = item.getAsFile() as FileWithOptionalPath | null;
      if (maybeFile?.path?.trim()) return maybeFile.path.trim();
    }

    const files = Array.from(e.dataTransfer.files ?? []) as FileWithOptionalPath[];
    const first = files.find((f) => typeof f.path === "string" && f.path.trim());
    if (first?.path?.trim()) return first.path.trim();

    // Finder/Electron fallback: dropped file paths can arrive as URI text
    // instead of File.path depending on drag source + platform permissions.
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (uriList) {
      const fromUriList = uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => decodeFileUri(line))
        .find((p): p is string => Boolean(p && p.startsWith("/")));
      if (fromUriList) return fromUriList;
    }

    const plain = e.dataTransfer.getData("text/plain");
    if (plain) {
      const fromPlain = plain
        .split(/\r?\n/)
        .map((line) => line.trim())
        .map((line) => decodeFileUri(line) ?? parseDownloadUrl(line) ?? (line.startsWith("/") ? line : null))
        .find((p): p is string => Boolean(p && p.startsWith("/")));
      if (fromPlain) return fromPlain;
    }

    const downloadUrl = e.dataTransfer.getData("DownloadURL");
    if (downloadUrl) {
      const fromDownload = parseDownloadUrl(downloadUrl);
      if (fromDownload?.startsWith("/")) return fromDownload;
    }

    return null;
  }

  function setOpenPathAction(index: number, action: DraftAction, path: string) {
    if (!draft) return;
    const next = [...draft.actions];
    next[index] = { ...action, path };
    setDraft({ ...draft, actions: next });
    setUiHint(null);
  }

  async function saveDraft() {
    if (!draft || !draft.name.trim()) {
      setError("Give the skill a name.");
      return;
    }
    const triggers = draft.triggersText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (triggers.length === 0) {
      setError("Add at least one trigger phrase.");
      return;
    }
    const actions = draft.actions.map(toSkillAction).filter((a): a is SkillAction => Boolean(a));
    if (actions.length === 0) {
      setError("Add at least one valid action.");
      return;
    }
    try {
      if (draft.id) {
        await nova().skillsUpdate({
          id: draft.id,
          name: draft.name.trim(),
          triggers,
          actions,
          enabled: draft.enabled,
        });
      } else {
        await nova().skillsCreate({
          name: draft.name.trim(),
          triggers,
          actions,
          enabled: draft.enabled,
        });
      }
      setDraft(null);
      setError(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save skill");
    }
  }

  async function runNow(id: string) {
    setBusyId(id);
    try {
      await nova().skillsRun(id);
    } finally {
      setBusyId(null);
    }
  }

  const inputCls =
    "rounded-full border border-white/[0.06] bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] text-[--nova-text] outline-none focus:border-white/[0.16] w-full";

  return (
    <>
      <Group>
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-[--nova-text]">Custom skills</div>
            <div className="text-[12px] leading-relaxed text-[--nova-text-secondary] mt-1">
              Create routines like "open chemistry tuition" that open files, apps, and links in one go.
            </div>
          </div>
          <button
            onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT, actions: [{ ...EMPTY_ACTION }] })}
            className="rounded-full border border-white/[0.08] bg-white/[0.07] px-4 py-1.5 text-[12.5px] font-medium text-[--nova-text] hover:bg-white/[0.12] transition-colors"
          >
            {draft && !draft.id ? "Close" : "New skill"}
          </button>
        </div>
      </Group>

      {draft && (
        <div className="mt-3 rounded-[22px] border border-white/[0.05] bg-white/[0.035] p-5 space-y-3">
          <input
            className={inputCls}
            placeholder="Skill name (e.g. Chemistry Tuition)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder='Trigger phrases, comma-separated (e.g. "open chemistry tuition, start chemistry")'
            value={draft.triggersText}
            onChange={(e) => setDraft({ ...draft, triggersText: e.target.value })}
          />
          <div className="space-y-2">
            {draft.actions.map((a, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={a.type}
                  onChange={(e) => {
                    const next = [...draft.actions];
                    next[idx] = { ...EMPTY_ACTION, type: e.target.value as ActionType };
                    setDraft({ ...draft, actions: next });
                  }}
                  className="w-36"
                >
                  <option value="open_path">Open file/folder</option>
                  <option value="open_app">Open app</option>
                  <option value="open_url">Open URL</option>
                  <option value="run_shortcut">Run shortcut</option>
                </Select>
                {a.type === "open_path" && (
                  <div className="w-full space-y-1.5">
                    <input
                      className={inputCls}
                      placeholder="/absolute/path/to/file"
                      value={a.path}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const path = firstDroppedPath(e);
                        if (!path) {
                          setUiHint("Drop detected but no filesystem path found. Try Choose or paste an absolute path.");
                          return;
                        }
                        setOpenPathAction(idx, a, path);
                      }}
                      onChange={(e) => setOpenPathAction(idx, a, e.target.value)}
                    />
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const path = firstDroppedPath(e);
                        if (!path) {
                          setUiHint("Drop detected but no filesystem path found. Try Choose or paste an absolute path.");
                          return;
                        }
                        setOpenPathAction(idx, a, path);
                      }}
                      className="rounded-xl border border-dashed border-white/20 bg-white/[0.03] px-3 py-2 text-[11.5px] text-[--nova-text-secondary]"
                    >
                      Drop from Finder here to auto-fill path
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() =>
                          void nova()
                            .skillsPickPath()
                            .then((picked) => {
                              if (!picked) {
                                setUiHint("Picker was cancelled.");
                                return;
                              }
                              setOpenPathAction(idx, a, picked);
                            })
                            .catch((err) => {
                              setUiHint(
                                `Path picker failed: ${
                                  err instanceof Error ? err.message : "unknown error"
                                }. Restart the app and try again.`,
                              );
                            })
                        }
                        className="rounded-full border border-white/[0.08] bg-white/[0.07] px-3 py-1 text-[11.5px] text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/[0.12] transition-colors"
                      >
                        Choose…
                      </button>
                    </div>
                  </div>
                )}
                {a.type === "open_app" && (
                  <input
                    className={inputCls}
                    placeholder="App name (e.g. Notion)"
                    value={a.app_name}
                    onChange={(e) => {
                      const next = [...draft.actions];
                      next[idx] = { ...a, app_name: e.target.value };
                      setDraft({ ...draft, actions: next });
                    }}
                  />
                )}
                {a.type === "open_url" && (
                  <input
                    className={inputCls}
                    placeholder="https://..."
                    value={a.url}
                    onChange={(e) => {
                      const next = [...draft.actions];
                      next[idx] = { ...a, url: e.target.value };
                      setDraft({ ...draft, actions: next });
                    }}
                  />
                )}
                {a.type === "run_shortcut" && (
                  <div className="flex gap-2 w-full">
                    <input
                      className={inputCls}
                      placeholder="Shortcut name"
                      value={a.name}
                      onChange={(e) => {
                        const next = [...draft.actions];
                        next[idx] = { ...a, name: e.target.value };
                        setDraft({ ...draft, actions: next });
                      }}
                    />
                    <input
                      className={inputCls}
                      placeholder="Optional input"
                      value={a.input}
                      onChange={(e) => {
                        const next = [...draft.actions];
                        next[idx] = { ...a, input: e.target.value };
                        setDraft({ ...draft, actions: next });
                      }}
                    />
                  </div>
                )}
                <button
                  onClick={() => {
                    const next = draft.actions.filter((_, i) => i !== idx);
                    setDraft({ ...draft, actions: next.length ? next : [{ ...EMPTY_ACTION }] });
                  }}
                  className="rounded-full border border-red-400/20 bg-red-500/[0.08] px-3 py-1 text-[11.5px] text-red-300/90 hover:bg-red-500/[0.15] transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() => setDraft({ ...draft, actions: [...draft.actions, { ...EMPTY_ACTION }] })}
              className="rounded-full border border-white/[0.08] bg-white/[0.07] px-3 py-1 text-[11.5px] text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/[0.12] transition-colors"
            >
              Add action
            </button>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[--nova-text-secondary]">
            Enabled
            <Toggle value={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
          </label>
          {uiHint && <div className="text-[12px] text-amber-300">{uiHint}</div>}
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
              className="rounded-full bg-[--nova-accent] px-4 py-1.5 text-[12.5px] font-medium text-white transition-opacity"
            >
              {draft.id ? "Save changes" : "Create skill"}
            </button>
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div className="mt-3">
          <Group>
            {skills.map((skill) => (
              <div key={skill.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-[--nova-text] truncate">
                      {skill.name}
                    </div>
                    <div className="text-[11.5px] text-[--nova-text-secondary] mt-0.5 truncate">
                      Triggers: {skill.triggers.join(", ")}
                    </div>
                    <div className="text-[11.5px] text-[--nova-text-secondary]/80 mt-0.5 truncate">
                      {skill.actions.length} action{skill.actions.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Toggle
                      value={skill.enabled}
                      onChange={(v) => void nova().skillsUpdate({ id: skill.id, enabled: v }).then(refresh)}
                    />
                    <button
                      onClick={() => void runNow(skill.id)}
                      disabled={busyId === skill.id}
                      className="rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1 text-[11.5px] text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/[0.1] disabled:opacity-40 transition-colors"
                    >
                      {busyId === skill.id ? "Running…" : "Run now"}
                    </button>
                    <button
                      onClick={() => setDraft(decode(skill))}
                      className="rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1 text-[11.5px] text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/[0.1] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void nova().skillsDelete(skill.id).then(refresh)}
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

      {skills.length === 0 && !draft && (
        <p className="mt-4 px-2 text-[12px] text-[--nova-text-secondary]">
          No custom skills yet. Add one and then trigger it by voice phrase, like "open chemistry tuition".
        </p>
      )}
    </>
  );
}
