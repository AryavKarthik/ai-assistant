import { useEffect, useRef, useState } from "react";
import { nova } from "../lib/ipc";
import type { AllPrefs, VoicePreferences, ProactivePrefs, AuthState } from "@shared/types";
import { DEFAULT_VOICE_PREFERENCES, DEFAULT_PROACTIVE_PREFS } from "@shared/types";
import { Select } from "../components/ui/Select";
import { cn } from "../lib/utils";

// ─── macOS-style building blocks ─────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "relative w-[38px] h-[22px] rounded-full transition-colors duration-200 flex-shrink-0",
        value ? "bg-[--nova-accent]" : "bg-white/20",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm",
          "transition-transform duration-200",
          value ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.04] divide-y divide-white/6 overflow-hidden">
      {children}
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] text-[--nova-text]">{label}</div>
        {description && (
          <div className="text-[11.5px] leading-snug text-[--nova-text-secondary] mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} description={description}>
      <span className="text-[12px] tabular-nums text-[--nova-text-secondary] w-12 text-right">
        {format ? format(value) : value.toFixed(2)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 accent-[--nova-accent]"
      />
    </Row>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-[17px] font-semibold text-[--nova-text]">{title}</h1>
      {subtitle && <p className="text-[12px] text-[--nova-text-secondary] mt-0.5">{subtitle}</p>}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--nova-text-secondary]">
      {children}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

type SectionId = "general" | "voice" | "conversation" | "sounds" | "proactive" | "account";

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "⚙︎" },
  { id: "voice", label: "Voice & Speech", icon: "🎙" },
  { id: "conversation", label: "Conversation", icon: "💬" },
  { id: "sounds", label: "Sounds", icon: "🔔" },
  { id: "proactive", label: "Proactive", icon: "✨" },
  { id: "account", label: "Account", icon: "👤" },
];

const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
];

const DEEPGRAM_VOICES = [
  "aura-asteria-en", "aura-luna-en", "aura-stella-en", "aura-athena-en",
  "aura-hera-en", "aura-orion-en", "aura-arcas-en", "aura-perseus-en",
  "aura-angus-en", "aura-orpheus-en", "aura-helios-en", "aura-zeus-en",
];

export function SettingsPage() {
  const [voice, setVoice] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [proactive, setProactive] = useState<ProactivePrefs>(DEFAULT_PROACTIVE_PREFS);
  const [section, setSection] = useState<SectionId>("general");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    nova().prefsGet().then((p) => {
      const all = p as AllPrefs;
      setVoice({ ...DEFAULT_VOICE_PREFERENCES, ...all.voice });
      setProactive({ ...DEFAULT_PROACTIVE_PREFS, ...all.proactive });
    }).catch(() => {});
    nova().authStatus().then(setAuth).catch(() => {});
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  async function persist(voiceNext: VoicePreferences, proactiveNext: ProactivePrefs) {
    setSaveState("saving");
    try {
      await nova().prefsSet({ voice: voiceNext, proactive: proactiveNext });
      setSaveState("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  /** Immediate save — toggles, selects, discrete inputs. */
  function save(voicePatch?: Partial<VoicePreferences>, proactivePatch?: Partial<ProactivePrefs>) {
    const v = voicePatch ? { ...voice, ...voicePatch } : voice;
    const p = proactivePatch ? { ...proactive, ...proactivePatch } : proactive;
    if (voicePatch) setVoice(v);
    if (proactivePatch) setProactive(p);
    void persist(v, p);
  }

  /** Debounced save — sliders that fire on every tick. */
  function saveDebounced(voicePatch: Partial<VoicePreferences>) {
    const v = { ...voice, ...voicePatch };
    setVoice(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void persist(v, proactive), 500);
  }

  return (
    <div className="flex h-full max-w-3xl mx-auto pt-4">
      {/* Sidebar */}
      <nav className="w-44 flex-shrink-0 pr-4">
        <div className="space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                section === s.id
                  ? "bg-[--nova-accent] text-white"
                  : "text-[--nova-text] hover:bg-white/6",
              )}
            >
              <span className="text-[13px] w-5 text-center opacity-90">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-10">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {section === "general" && (
              <>
                <SectionTitle title="General" subtitle="How Nova listens and wakes up." />
                <Group>
                  <Row label="Interaction mode" description="How you start talking to Nova.">
                    <Select
                      value={voice.interactionMode}
                      onChange={(e) => save({ interactionMode: e.target.value as VoicePreferences["interactionMode"] })}
                      className="w-40"
                    >
                      <option value="off">Off</option>
                      <option value="wake_word">Wake word</option>
                      <option value="conversation">Conversation</option>
                    </Select>
                  </Row>
                  <SliderRow
                    label="Wake word sensitivity"
                    description="Higher fires easier, but may false-trigger."
                    value={voice.wakeWordSensitivity}
                    min={0.35} max={0.85} step={0.05}
                    onChange={(v) => saveDebounced({ wakeWordSensitivity: v })}
                  />
                </Group>
                <GroupLabel>Popup</GroupLabel>
                <Group>
                  <Row
                    label="Show popup on wake word"
                    description="Nova slides in at the top-right of your screen when you say the wake word, and tucks away when done."
                  >
                    <span className="text-[12px] text-[--nova-text-secondary]">Always on</span>
                  </Row>
                  <Row label="Keyboard shortcut" description="Toggle the popup manually.">
                    <kbd className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-[11px] text-[--nova-text-secondary]">
                      ⌘ ⇧ Space
                    </kbd>
                  </Row>
                </Group>
              </>
            )}

            {section === "voice" && (
              <>
                <SectionTitle title="Voice & Speech" subtitle="Speech recognition and Nova's voice." />
                <GroupLabel>Speech recognition</GroupLabel>
                <Group>
                  <Row label="Provider">
                    <Select
                      value={voice.sttProvider}
                      onChange={(e) => save({ sttProvider: e.target.value as VoicePreferences["sttProvider"] })}
                      className="w-36"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="google">Google</option>
                    </Select>
                  </Row>
                </Group>
                <GroupLabel>Nova's voice</GroupLabel>
                <Group>
                  <Row label="Speak replies aloud">
                    <Toggle value={voice.spokenReplies} onChange={(v) => save({ spokenReplies: v })} />
                  </Row>
                  <Row label="Provider">
                    <Select
                      value={voice.ttsProvider}
                      onChange={(e) => save({ ttsProvider: e.target.value as VoicePreferences["ttsProvider"] })}
                      className="w-36"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="google">Google</option>
                      <option value="deepgram">Deepgram</option>
                    </Select>
                  </Row>
                  {voice.ttsProvider === "openai" && (
                    <Row label="Voice">
                      <Select
                        value={voice.ttsVoice}
                        onChange={(e) => save({ ttsVoice: e.target.value })}
                        className="w-36 capitalize"
                      >
                        {OPENAI_VOICES.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </Select>
                    </Row>
                  )}
                  {voice.ttsProvider === "deepgram" && (
                    <Row label="Voice">
                      <Select
                        value={voice.deepgramTtsVoice}
                        onChange={(e) => save({ deepgramTtsVoice: e.target.value })}
                        className="w-44"
                      >
                        {DEEPGRAM_VOICES.map((v) => (
                          <option key={v} value={v}>{v.replace("aura-", "").replace("-en", "")}</option>
                        ))}
                      </Select>
                    </Row>
                  )}
                  <SliderRow
                    label="Speaking speed"
                    value={voice.ttsSpeed}
                    min={0.75} max={2.0} step={0.05}
                    format={(v) => `${v.toFixed(2)}×`}
                    onChange={(v) => saveDebounced({ ttsSpeed: v })}
                  />
                  {voice.ttsProvider === "openai" && (
                    <Row label="High-quality audio" description="Slightly slower first response.">
                      <Toggle value={voice.ttsHd} onChange={(v) => save({ ttsHd: v })} />
                    </Row>
                  )}
                </Group>
              </>
            )}

            {section === "conversation" && (
              <>
                <SectionTitle title="Conversation" subtitle="Pace and interruption while talking." />
                <Group>
                  <SliderRow
                    label="End-of-speech pause"
                    description="How long Nova waits after you stop talking. Shorter feels snappier."
                    value={voice.silenceMs}
                    min={400} max={2500} step={100}
                    format={(v) => `${(v / 1000).toFixed(1)}s`}
                    onChange={(v) => saveDebounced({ silenceMs: v })}
                  />
                  <SliderRow
                    label="Listening sensitivity"
                    description="How easily your voice registers over background noise."
                    value={voice.listeningSensitivity}
                    min={0} max={1} step={0.05}
                    onChange={(v) => saveDebounced({ listeningSensitivity: v })}
                  />
                </Group>
                <GroupLabel>Interrupting Nova</GroupLabel>
                <Group>
                  <Row label="Barge-in" description="Start talking over Nova to interrupt a reply.">
                    <Toggle value={voice.bargeInEnabled} onChange={(v) => save({ bargeInEnabled: v })} />
                  </Row>
                  {voice.bargeInEnabled && (
                    <SliderRow
                      label="Barge-in sensitivity"
                      description="Higher interrupts faster but may trip on background noise."
                      value={voice.bargeInSensitivity}
                      min={0} max={1} step={0.05}
                      onChange={(v) => saveDebounced({ bargeInSensitivity: v })}
                    />
                  )}
                </Group>
              </>
            )}

            {section === "sounds" && (
              <>
                <SectionTitle title="Sounds" subtitle="Audio feedback while you talk to Nova." />
                <Group>
                  <Row
                    label="Audio cues"
                    description="Chimes for wake, thinking, interruptions, errors, and timers."
                  >
                    <Toggle value={voice.audioCuesEnabled} onChange={(v) => save({ audioCuesEnabled: v })} />
                  </Row>
                  <Row label="Wake acknowledgement" description="What Nova does the instant it hears the wake word.">
                    <Select
                      value={voice.instantAckMode}
                      onChange={(e) => save({ instantAckMode: e.target.value as VoicePreferences["instantAckMode"] })}
                      className="w-36"
                    >
                      <option value="off">Nothing</option>
                      <option value="earcon">Chime</option>
                      <option value="spoken">Say "Got it"</option>
                    </Select>
                  </Row>
                </Group>
              </>
            )}

            {section === "proactive" && (
              <>
                <SectionTitle title="Proactive" subtitle="Briefs and nudges Nova sends on its own." />
                <Group>
                  <Row label="Proactive mode">
                    <Select
                      value={proactive.proactiveMode}
                      onChange={(e) => save(undefined, { proactiveMode: e.target.value as ProactivePrefs["proactiveMode"] })}
                      className="w-40"
                    >
                      <option value="off">Off</option>
                      <option value="reminders_only">Reminders only</option>
                      <option value="full">Full</option>
                    </Select>
                  </Row>
                  <Row label="Daily brief" description="A morning summary of your day.">
                    <Toggle
                      value={proactive.dailyBriefEnabled}
                      onChange={(v) => save(undefined, { dailyBriefEnabled: v })}
                    />
                  </Row>
                  {proactive.dailyBriefEnabled && (
                    <Row label="Brief time">
                      <input
                        type="time"
                        value={proactive.briefTimeLocal}
                        onChange={(e) => save(undefined, { briefTimeLocal: e.target.value })}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-sm text-[--nova-text]"
                      />
                    </Row>
                  )}
                </Group>
                <GroupLabel>Quiet hours</GroupLabel>
                <Group>
                  <Row label="Do not disturb" description="No proactive notifications in this window.">
                    <div className="flex items-center gap-2 text-sm">
                      <input
                        type="time"
                        value={proactive.quietHoursStart}
                        onChange={(e) => save(undefined, { quietHoursStart: e.target.value })}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-[--nova-text]"
                      />
                      <span className="text-[--nova-text-secondary]">–</span>
                      <input
                        type="time"
                        value={proactive.quietHoursEnd}
                        onChange={(e) => save(undefined, { quietHoursEnd: e.target.value })}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-[--nova-text]"
                      />
                    </div>
                  </Row>
                </Group>
              </>
            )}

            {section === "account" && (
              <>
                <SectionTitle title="Account" />
                <Group>
                  <Row label="Signed in as">
                    <span className="text-[13px] text-[--nova-text-secondary]">
                      {auth.email ?? "—"}
                    </span>
                  </Row>
                  <Row label="Sign out" description="You'll need a new magic link to sign back in.">
                    <button
                      onClick={() => void nova().authSignOut()}
                      className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[12.5px] text-red-300 hover:bg-red-500/20 transition-colors"
                    >
                      Sign out…
                    </button>
                  </Row>
                </Group>
              </>
            )}
          </div>

          {/* Save indicator */}
          <div className="w-20 text-right text-[11.5px] text-[--nova-text-secondary] pt-1.5 flex-shrink-0">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && <span className="text-emerald-400">Saved ✓</span>}
            {saveState === "error" && <span className="text-red-400">Save failed</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
