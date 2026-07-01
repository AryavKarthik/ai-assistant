import { useEffect, useState } from "react";
import { nova } from "../lib/ipc";
import type { AllPrefs, VoicePreferences, ProactivePrefs } from "@shared/types";
import { DEFAULT_VOICE_PREFERENCES, DEFAULT_PROACTIVE_PREFS } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/6 last:border-0">
      <span className="text-sm text-[--nova-text]">{label}</span>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <SettingRow label={label}>
      <button
        onClick={() => onChange(!value)}
        className={`w-10 h-6 rounded-full transition-colors ${value ? "bg-[--nova-accent]" : "bg-white/15"}`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white transition-transform mx-1 ${value ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </SettingRow>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <SettingRow label={`${label}: ${value.toFixed(2)}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32"
      />
    </SettingRow>
  );
}

export function SettingsPage() {
  const [voice, setVoice] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [proactive, setProactive] = useState<ProactivePrefs>(DEFAULT_PROACTIVE_PREFS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    nova().prefsGet().then((p) => {
      const all = p as AllPrefs;
      setVoice({ ...DEFAULT_VOICE_PREFERENCES, ...all.voice });
      setProactive({ ...DEFAULT_PROACTIVE_PREFS, ...all.proactive });
    }).catch(() => {});
  }, []);

  async function save(voicePatch?: Partial<VoicePreferences>, proactivePatch?: Partial<ProactivePrefs>) {
    setSaving(true);
    try {
      await nova().prefsSet({
        voice: voicePatch ? { ...voice, ...voicePatch } : undefined,
        proactive: proactivePatch ? { ...proactive, ...proactivePatch } : undefined,
      });
      if (voicePatch) setVoice((v) => ({ ...v, ...voicePatch }));
      if (proactivePatch) setProactive((p) => ({ ...p, ...proactivePatch }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-6">
      <h1 className="text-lg font-semibold text-[--nova-text]">Settings</h1>

      {/* Voice section */}
      <Card>
        <h2 className="text-sm font-medium text-[--nova-text-secondary] mb-3">Voice</h2>

        <SettingRow label="Interaction mode">
          <Select
            value={voice.interactionMode}
            onChange={(e) => void save({ interactionMode: e.target.value as VoicePreferences["interactionMode"] })}
            className="w-40"
          >
            <option value="off">Off</option>
            <option value="wake_word">Wake word</option>
            <option value="conversation">Conversation</option>
          </Select>
        </SettingRow>

        <SliderRow
          label="Wake sensitivity"
          value={voice.wakeWordSensitivity}
          min={0.35}
          max={0.85}
          step={0.05}
          onChange={(v) => void save({ wakeWordSensitivity: v })}
        />

        <SettingRow label="Speech-to-text">
          <Select
            value={voice.sttProvider}
            onChange={(e) => void save({ sttProvider: e.target.value as VoicePreferences["sttProvider"] })}
            className="w-32"
          >
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
          </Select>
        </SettingRow>

        <SettingRow label="Text-to-speech">
          <Select
            value={voice.ttsProvider}
            onChange={(e) => void save({ ttsProvider: e.target.value as VoicePreferences["ttsProvider"] })}
            className="w-32"
          >
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
            <option value="deepgram">Deepgram</option>
          </Select>
        </SettingRow>

        <SliderRow label="Speech speed" value={voice.ttsSpeed} min={0.75} max={2.0} step={0.05}
          onChange={(v) => void save({ ttsSpeed: v })} />

        <ToggleRow label="Speak replies aloud" value={voice.spokenReplies}
          onChange={(v) => void save({ spokenReplies: v })} />

        <SettingRow label="Thinking sound">
          <Select
            value={voice.instantAckMode}
            onChange={(e) => void save({ instantAckMode: e.target.value as VoicePreferences["instantAckMode"] })}
            className="w-36"
          >
            <option value="off">Off</option>
            <option value="earcon">Soft tick</option>
            <option value="spoken">Say &quot;Got it&quot;</option>
          </Select>
        </SettingRow>

        <SliderRow label="Listening sensitivity" value={voice.listeningSensitivity} min={0} max={1} step={0.05}
          onChange={(v) => void save({ listeningSensitivity: v })} />

        <SettingRow label="Silence before send (ms)">
          <input
            type="number"
            min={300}
            max={3000}
            step={100}
            value={voice.silenceMs}
            onChange={(e) => void save({ silenceMs: Number(e.target.value) })}
            className="w-24 rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-sm text-[--nova-text] text-right"
          />
        </SettingRow>

        <ToggleRow label="Barge-in (interrupt replies)" value={voice.bargeInEnabled}
          onChange={(v) => void save({ bargeInEnabled: v })} />

        {voice.bargeInEnabled && (
          <SliderRow label="Barge-in sensitivity" value={voice.bargeInSensitivity} min={0} max={1} step={0.05}
            onChange={(v) => void save({ bargeInSensitivity: v })} />
        )}
      </Card>

      {/* Proactive section */}
      <Card>
        <h2 className="text-sm font-medium text-[--nova-text-secondary] mb-3">Proactive</h2>

        <SettingRow label="Proactive mode">
          <Select
            value={proactive.proactiveMode}
            onChange={(e) => void save(undefined, { proactiveMode: e.target.value as ProactivePrefs["proactiveMode"] })}
            className="w-40"
          >
            <option value="off">Off</option>
            <option value="reminders_only">Reminders only</option>
            <option value="full">Full</option>
          </Select>
        </SettingRow>

        <ToggleRow label="Daily brief" value={proactive.dailyBriefEnabled}
          onChange={(v) => void save(undefined, { dailyBriefEnabled: v })} />

        {proactive.dailyBriefEnabled && (
          <SettingRow label="Brief time">
            <input
              type="time"
              value={proactive.briefTimeLocal}
              onChange={(e) => void save(undefined, { briefTimeLocal: e.target.value })}
              className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-sm text-[--nova-text]"
            />
          </SettingRow>
        )}

        <SettingRow label="Quiet hours">
          <div className="flex items-center gap-2 text-sm">
            <input
              type="time"
              value={proactive.quietHoursStart}
              onChange={(e) => void save(undefined, { quietHoursStart: e.target.value })}
              className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-[--nova-text]"
            />
            <span className="text-[--nova-text-secondary]">–</span>
            <input
              type="time"
              value={proactive.quietHoursEnd}
              onChange={(e) => void save(undefined, { quietHoursEnd: e.target.value })}
              className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-[--nova-text]"
            />
          </div>
        </SettingRow>
      </Card>

      {(saving || saved) && (
        <div className="text-xs text-center text-[--nova-text-secondary]">
          {saving ? "Saving…" : "Saved ✓"}
        </div>
      )}
    </div>
  );
}
