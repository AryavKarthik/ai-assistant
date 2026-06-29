"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GoogleVoiceQuality, VoiceInteractionMode, VoicePreferences } from "@/lib/voice/types";
import {
  GOOGLE_VOICE_QUALITY_OPTIONS,
  googleTtsVoicesForQuality,
  normalizeGoogleTtsVoice,
} from "@/lib/voice/google-quality";
import { OPENAI_TTS_VOICES, DEEPGRAM_TTS_VOICES } from "@/lib/voice/tts/types";
import { getWakePhraseLabel, formatWakePhrasesForInput, parseWakePhrasesInput } from "@/lib/voice/wake/phrases";
import { isWakeWordSupported } from "@/lib/voice/wake";
import { Button } from "@/components/ui/primitives";

function WakePhrasesField({
  phrases,
  onChange,
}: {
  phrases: string[];
  onChange: (phrases: string[]) => void;
}) {
  const [draft, setDraft] = useState(() => formatWakePhrasesForInput(phrases));

  useEffect(() => {
    setDraft(formatWakePhrasesForInput(phrases));
  }, [phrases]);

  const commit = () => {
    const next = parseWakePhrasesInput(draft);
    onChange(next.length ? next : ["hey nova"]);
    setDraft(formatWakePhrasesForInput(next.length ? next : ["hey nova"]));
  };

  return (
    <label className="app-voice-settings-field">
      <span>Wake phrases</span>
      <textarea
        className="app-voice-settings-textarea"
        rows={3}
        value={draft}
        placeholder={"hey nova\ncomputer"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </label>
  );
}

function SilenceMsField({
  silenceMs,
  onChange,
  label = "Silence before send (ms)",
  min = 300,
  max = 3000,
}: {
  silenceMs: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(silenceMs));

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== silenceMs) {
      onChange(clamped);
    }
  };

  return (
    <label className="app-voice-settings-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={100}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            onChange(parsed);
          }
        }}
        onBlur={() => commit(draft)}
      />
    </label>
  );
}

interface VoiceSettingsPanelProps {
  open: boolean;
  preferences: VoicePreferences;
  onChange: (patch: Partial<VoicePreferences>) => void;
  onClose: () => void;
}

export function VoiceSettingsPanel({
  open,
  preferences,
  onChange,
  onClose,
}: VoiceSettingsPanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  const isGoogleStt = preferences.sttProvider === "google";
  const isGoogleTts = preferences.ttsProvider === "google";
  const isDeepgramTts = preferences.ttsProvider === "deepgram";
  const wakeSupported = isWakeWordSupported();
  const googleTtsVoices = googleTtsVoicesForQuality(preferences.googleTtsQuality);

  const handleGoogleSttQualityChange = (quality: GoogleVoiceQuality) => {
    onChange({ googleSttQuality: quality });
  };

  const handleGoogleTtsQualityChange = (quality: GoogleVoiceQuality) => {
    onChange({
      googleTtsQuality: quality,
      googleTtsVoice: normalizeGoogleTtsVoice(
        preferences.googleTtsVoice,
        quality,
      ),
    });
  };

  return createPortal(
    <div
      className="app-voice-modal-backdrop app-voice-modal-backdrop--stage"
      role="dialog"
      aria-label="Voice settings"
      onClick={onClose}
    >
      <div
        className="app-voice-settings app-voice-settings-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-voice-settings-header">
          <h3>Voice settings</h3>
          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="app-voice-settings-body">
          <label className="app-voice-settings-field">
            <span>Voice mode</span>
            <select
              value={preferences.interactionMode}
              onChange={(e) =>
                onChange({ interactionMode: e.target.value as VoiceInteractionMode })
              }
            >
              <option value="off">Off (push-to-talk only)</option>
              <option value="conversation">Conversation</option>
              <option value="wake_word">Wake word</option>
            </select>
          </label>

          {preferences.interactionMode === "wake_word" ? (
            <>
              <WakePhrasesField
                phrases={preferences.wakePhrases}
                onChange={(wakePhrases) => onChange({ wakePhrases })}
              />
              <label className="app-voice-settings-field">
                <span>Wake word match sensitivity</span>
                <input
                  type="range"
                  min={0.35}
                  max={0.85}
                  step={0.05}
                  value={preferences.wakeWordSensitivity}
                  onChange={(e) =>
                    onChange({ wakeWordSensitivity: Number(e.target.value) })
                  }
                />
              </label>
              <p className="app-voice-settings-note">
                Say <strong>{getWakePhraseLabel(preferences.wakePhrases)}</strong>{" "}
                from the chat screen — no need to tap the mic first. Listening starts
                automatically while this tab is open.
                {!wakeSupported
                  ? " Your browser does not support wake word (try Chrome, Edge, or Safari)."
                  : " Chrome needs an internet connection for speech recognition."}
              </p>
            </>
          ) : null}

          <label className="app-voice-settings-field">
            <span>Speech-to-text</span>
            <select
              value={preferences.sttProvider}
              onChange={(e) =>
                onChange({
                  sttProvider: e.target.value === "google" ? "google" : "openai",
                })
              }
            >
              <option value="openai">OpenAI (recommended)</option>
              <option value="google">Google Cloud</option>
            </select>
          </label>

          {isGoogleStt ? (
            <label className="app-voice-settings-field">
              <span>Google transcription quality</span>
              <select
                value={preferences.googleSttQuality}
                onChange={(e) =>
                  handleGoogleSttQualityChange(
                    e.target.value as GoogleVoiceQuality,
                  )
                }
              >
                {GOOGLE_VOICE_QUALITY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="app-voice-settings-note">
                {
                  GOOGLE_VOICE_QUALITY_OPTIONS.find(
                    (option) => option.id === preferences.googleSttQuality,
                  )?.description
                }
              </p>
            </label>
          ) : null}

          <label className="app-voice-settings-field">
            <span>Text-to-speech</span>
            <select
              value={preferences.ttsProvider}
              onChange={(e) =>
                onChange({
                  ttsProvider: e.target.value === "google" ? "google" : e.target.value === "deepgram" ? "deepgram" : "openai",
                })
              }
              disabled={!preferences.spokenReplies}
            >
              <option value="openai">OpenAI (gpt-4o-mini-tts)</option>
              <option value="google">Google Cloud</option>
              <option value="deepgram">Deepgram (Aura)</option>
            </select>
          </label>

          {isGoogleTts ? (
            <label className="app-voice-settings-field">
              <span>Google speech quality</span>
              <select
                value={preferences.googleTtsQuality}
                onChange={(e) =>
                  handleGoogleTtsQualityChange(
                    e.target.value as GoogleVoiceQuality,
                  )
                }
                disabled={!preferences.spokenReplies}
              >
                {GOOGLE_VOICE_QUALITY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="app-voice-settings-note">
                {
                  GOOGLE_VOICE_QUALITY_OPTIONS.find(
                    (option) => option.id === preferences.googleTtsQuality,
                  )?.description
                }{" "}
                High uses Chirp 3 HD voices.
              </p>
            </label>
          ) : null}

          {isDeepgramTts ? (
            <label className="app-voice-settings-field">
              <span>Deepgram voice</span>
              <select
                value={preferences.deepgramTtsVoice}
                onChange={(e) => onChange({ deepgramTtsVoice: e.target.value })}
                disabled={!preferences.spokenReplies}
              >
                {DEEPGRAM_TTS_VOICES.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="app-voice-settings-check">
            <input
              type="checkbox"
              checked={preferences.spokenReplies}
              onChange={(e) => onChange({ spokenReplies: e.target.checked })}
            />
            <span>Speak replies aloud</span>
          </label>

          <label className="app-voice-settings-check">
            <input
              type="checkbox"
              checked={preferences.bargeInEnabled}
              onChange={(e) => onChange({ bargeInEnabled: e.target.checked })}
            />
            <span>Interrupt while assistant is speaking</span>
          </label>

          {preferences.bargeInEnabled ? (
            <div className="app-voice-settings-section">
              <h4 className="app-voice-settings-subhead">Barge-in timing</h4>
              <p className="app-voice-settings-note">
                Increase pause values if the assistant cuts you off too quickly
                during an interrupt.
              </p>
              <SilenceMsField
                key={`barge-${preferences.bargeInSilenceMs}`}
                silenceMs={preferences.bargeInSilenceMs}
                onChange={(bargeInSilenceMs) => onChange({ bargeInSilenceMs })}
                label="Interrupt pause before send (ms)"
                min={500}
                max={4000}
              />
              <SilenceMsField
                key={`abort-${preferences.bargeInAbortMs}`}
                silenceMs={preferences.bargeInAbortMs}
                onChange={(bargeInAbortMs) => onChange({ bargeInAbortMs })}
                label="Max interrupt capture time (ms)"
                min={3000}
                max={15000}
              />
              <label className="app-voice-settings-field">
                <span>
                  Hands-free interrupt sensitivity (
                  {Math.round(preferences.bargeInSensitivity * 100)}%)
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={preferences.bargeInSensitivity}
                  onChange={(e) =>
                    onChange({ bargeInSensitivity: Number(e.target.value) })
                  }
                />
              </label>
              <p className="app-voice-settings-note">
                Lower sensitivity reacts slower and is less likely to trigger
                from speaker bleed.
              </p>
            </div>
          ) : null}

          <label className="app-voice-settings-field">
            <span>Thinking sound</span>
            <select
              value={
                preferences.instantAckMode === "spoken" || preferences.instantAck
                  ? "spoken"
                  : preferences.instantAckMode
              }
              onChange={(e) => {
                const value = e.target.value;
                if (value === "off") {
                  onChange({ instantAckMode: "off", instantAck: false });
                } else if (value === "earcon") {
                  onChange({ instantAckMode: "earcon", instantAck: false });
                } else {
                  onChange({ instantAckMode: "spoken", instantAck: true });
                }
              }}
              disabled={!preferences.spokenReplies}
            >
              <option value="off">Off</option>
              <option value="earcon">Soft tick</option>
              <option value="spoken">Say &quot;Got it&quot;</option>
            </select>
          </label>

          <label className="app-voice-settings-field">
            <span>
              Listening sensitivity ({Math.round(preferences.listeningSensitivity * 100)}%)
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={preferences.listeningSensitivity}
              onChange={(e) =>
                onChange({ listeningSensitivity: Number(e.target.value) })
              }
            />
          </label>

          {!isDeepgramTts ? (
            <label className="app-voice-settings-field">
              <span>Reply voice</span>
              <select
                value={isGoogleTts ? preferences.googleTtsVoice : preferences.ttsVoice}
                onChange={(e) =>
                  onChange(
                    isGoogleTts
                      ? { googleTtsVoice: e.target.value }
                      : { ttsVoice: e.target.value },
                  )
                }
                disabled={!preferences.spokenReplies}
              >
                {(isGoogleTts ? googleTtsVoices : OPENAI_TTS_VOICES).map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="app-voice-settings-field">
            <span>Speech speed{isDeepgramTts ? " (not supported by Deepgram)" : ""}</span>
            <input
              type="range"
              min={0.75}
              max={2.0}
              step={0.05}
              value={preferences.ttsSpeed}
              disabled={!preferences.spokenReplies || isDeepgramTts}
              onChange={(e) => onChange({ ttsSpeed: Number(e.target.value) })}
            />
          </label>

          <label className="app-voice-settings-check">
            <input
              type="checkbox"
              checked={preferences.ttsHd}
              onChange={(e) => onChange({ ttsHd: e.target.checked })}
              disabled={!preferences.spokenReplies || isGoogleTts || isDeepgramTts}
            />
            <span>Extra expressive voice (OpenAI only)</span>
          </label>

          <label className="app-voice-settings-check">
            <input
              type="checkbox"
              checked={preferences.autoSendOnEndOfTurn}
              onChange={(e) => onChange({ autoSendOnEndOfTurn: e.target.checked })}
            />
            <span>Auto-send when I stop speaking (conversation mode)</span>
          </label>

          <SilenceMsField
            key={preferences.silenceMs}
            silenceMs={preferences.silenceMs}
            onChange={(silenceMs) => onChange({ silenceMs })}
          />

          {(preferences.sttProvider === "openai" ||
            preferences.ttsProvider === "openai") && (
            <div className="app-voice-settings-section">
              <h4 className="app-voice-settings-subhead">OpenAI models</h4>
              <p className="app-voice-settings-note">
                Fine-grained OpenAI model picks when not using Google Cloud.
              </p>

              {preferences.sttProvider === "openai" ? (
                <label className="app-voice-settings-field">
                  <span>OpenAI STT model</span>
                  <select
                    value={preferences.openAiSttModel}
                    onChange={(e) =>
                      onChange({
                        openAiSttModel: e.target
                          .value as VoicePreferences["openAiSttModel"],
                      })
                    }
                  >
                    <option value="gpt-4o-transcribe">gpt-4o-transcribe (best)</option>
                    <option value="gpt-4o-mini-transcribe">
                      gpt-4o-mini-transcribe (faster)
                    </option>
                    <option value="whisper-1">whisper-1 (legacy)</option>
                  </select>
                </label>
              ) : null}

              {preferences.ttsProvider === "openai" ? (
                <label className="app-voice-settings-field">
                  <span>OpenAI TTS model</span>
                  <select
                    value={preferences.openAiTtsModel}
                    onChange={(e) =>
                      onChange({
                        openAiTtsModel: e.target
                          .value as VoicePreferences["openAiTtsModel"],
                      })
                    }
                    disabled={!preferences.spokenReplies}
                  >
                    <option value="gpt-4o-mini-tts">gpt-4o-mini-tts (best)</option>
                    <option value="tts-1-hd">tts-1-hd (legacy HD)</option>
                    <option value="tts-1">tts-1 (legacy, fastest)</option>
                  </select>
                </label>
              ) : null}
            </div>
          )}

          <p className="app-voice-settings-note">
            Google Cloud needs <code>GCP_PROJECT_ID</code> and credentials with
            Speech + TTS APIs enabled. High STT uses Chirp 2 via the V2 API in{" "}
            <code>asia-southeast1</code> by default — override with{" "}
            <code>GCP_SPEECH_V2_LOCATION</code> if needed.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
