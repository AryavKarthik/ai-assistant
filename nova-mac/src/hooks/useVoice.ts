import { useEffect, useReducer, useRef, useState } from "react";
import { orbReducer, INITIAL_ORB_STATE } from "../orb/orb-machine";
import type { OrbState } from "../orb/orb-machine";
import { MicSession } from "../voice/mic-session";
import { MicAnalyser } from "../voice/mic-analyser";
import { TtsBargeInListener, ttsBargeInConfigFromSensitivity } from "../voice/tts-barge-in";
import { VoicePlayer } from "../voice/player";
import { startWakeCapture } from "../voice/wake-capture";
import { playCue } from "../voice/earcon";
import { sanitizeTranscript } from "../voice/transcript-filter";
import { isVoiceStopPhrase } from "../voice/stop-phrases";
import { nova } from "../lib/ipc";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

// No-speech giveup is configurable (VoicePreferences.noSpeechTimeoutMs,
// Settings → Conversation) — see recordUntilSilence.
const MAX_RECORDING_MS = 30_000;

/** Map listening sensitivity (0 strict … 1 sensitive) to a speech level threshold. */
function speechThreshold(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return 0.14 - s * 0.09; // 0.14 (strict) … 0.05 (sensitive)
}

async function recordUntilSilence(
  stream: MediaStream,
  options: { silenceMs: number; threshold: number; noSpeechTimeoutMs: number },
  onLevel: (level: number) => void,
): Promise<Blob> {
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  const mr = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mr.start(100);

  const analyser = new MicAnalyser();

  return new Promise((resolve) => {
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let speechSeen = false;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      analyser.stop();
      clearTimeout(silenceTimer ?? undefined);
      clearTimeout(noSpeechTimer);
      clearTimeout(maxTimer);
      // If the user never spoke, resolve empty so the caller can show "Nothing heard"
      // without paying for a pointless STT round-trip.
      if (mr.state !== "inactive") {
        mr.onstop = () => resolve(new Blob(speechSeen ? chunks : [], { type: mimeType }));
        try {
          mr.requestData();
          mr.stop();
        } catch {
          resolve(new Blob(speechSeen ? chunks : [], { type: mimeType }));
        }
      } else {
        resolve(new Blob(speechSeen ? chunks : [], { type: mimeType }));
      }
    }

    const noSpeechTimer = setTimeout(() => {
      if (!speechSeen) finish();
    }, options.noSpeechTimeoutMs);
    const maxTimer = setTimeout(finish, MAX_RECORDING_MS);

    analyser.start(stream, (level) => {
      onLevel(level);
      if (level > options.threshold) {
        speechSeen = true;
        if (silenceTimer !== null) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      } else if (speechSeen && silenceTimer === null) {
        silenceTimer = setTimeout(finish, options.silenceMs);
      }
    });
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin);
}

export function useVoice(): {
  state: OrbState;
  level: number;
  sendText: (text: string) => void;
} {
  const [state, dispatch] = useReducer(orbReducer, INITIAL_ORB_STATE);
  const [level, setLevel] = useState(0);

  const mic = useRef(new MicSession());
  const player = useRef(new VoicePlayer());
  const prefs = useRef<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const reqId = useRef(0);
  const cleanupTurn = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  /** True while any turn (voice or text) is streaming. */
  const busyRef = useRef(false);
  const sendTextRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    cancelledRef.current = false;
    let stopWake: (() => void) | null = null;

    function cue(name: Parameters<typeof playCue>[0]) {
      if (prefs.current.audioCuesEnabled !== false) playCue(name);
    }

    async function boot() {
      prefs.current = await nova().getVoicePreferences();
      if (cancelledRef.current) return;
      const stream = await mic.current.acquire();
      if (cancelledRef.current) return;
      stopWake = startWakeCapture(stream, (buf) => nova().sendWakeFrame(buf));
    }
    void boot();

    // Prefs updates pushed from main after Settings saves
    const offPrefs = nova().onPrefsChanged?.((p: unknown) => {
      prefs.current = p as VoicePreferences;
    });

    const offWake = nova().onWakeDetected(() => {
      if (!cancelledRef.current) {
        if (prefs.current.instantAckMode !== "off") cue("wake");
        void runTurn();
      }
    });

    // Timer fired (from the set_timer tool): chime + transient announcement.
    const offTimer = nova().onTimerFired?.((p) => {
      cue("timer");
      dispatch({ type: "notice", message: `Timer done — ${p.label}` });
      setTimeout(() => dispatch({ type: "dismiss" }), 7000);
    });

    function showError(message: string) {
      cue("error");
      dispatch({ type: "error", message });
      setTimeout(() => dispatch({ type: "dismiss" }), 2500);
    }

    // Typed chat turn: no recording, no TTS, no barge-in — just stream the reply
    // into the panel.
    function runTextTurn(text: string) {
      if (busyRef.current) return;
      busyRef.current = true;
      cleanupTurn.current?.();
      cleanupTurn.current = null;

      dispatch({ type: "summon" });
      dispatch({ type: "submit", transcript: text });
      dispatch({ type: "responseStart" });
      const id = `text-${++reqId.current}`;

      const offDelta = nova().onChatDelta((p) => {
        if (p.requestId !== id) return;
        dispatch({ type: "responseDelta", delta: p.delta });
      });
      const offTool = nova().onChatToolUse?.((p) => {
        if (p.requestId !== id) return;
        dispatch({ type: "startWorking", step: p.step });
      });
      const offDone = nova().onChatDone((p) => {
        if (p.requestId !== id) return;
        cleanup();
        dispatch({ type: "settle" });
        busyRef.current = false;
      });
      const offErr = nova().onChatError((p) => {
        if (p.requestId !== id) return;
        cleanup();
        showError(p.message ?? "Something went wrong");
        busyRef.current = false;
      });

      function cleanup() {
        offDelta();
        offTool?.();
        offDone();
        offErr();
        cleanupTurn.current = null;
      }
      cleanupTurn.current = cleanup;

      nova().chatSend({
        requestId: id,
        messages: [{ role: "user", content: text }],
        inputModality: "text",
      });
    }
    sendTextRef.current = runTextTurn;

    async function runTurn() {
      busyRef.current = true;
      cleanupTurn.current?.();
      cleanupTurn.current = null;

      dispatch({ type: "summon" });

      let stream: MediaStream;
      try {
        stream = await mic.current.acquire();
      } catch {
        showError("Mic unavailable");
        endTurn();
        return;
      }
      if (cancelledRef.current) {
        dispatch({ type: "dismiss" });
        return;
      }

      let audio: Blob;
      try {
        audio = await recordUntilSilence(
          stream,
          {
            silenceMs: prefs.current.silenceMs,
            threshold: speechThreshold(prefs.current.listeningSensitivity),
            noSpeechTimeoutMs: prefs.current.noSpeechTimeoutMs,
          },
          (l) => setLevel(l),
        );
      } catch {
        showError("Recording failed");
        endTurn();
        return;
      }
      setLevel(0);
      if (cancelledRef.current) {
        dispatch({ type: "dismiss" });
        return;
      }

      if (audio.size === 0) {
        showError("Nothing heard");
        endTurn();
        return;
      }

      // Acknowledge that we heard them the moment recording closes.
      cue("gotIt");

      let transcript = "";
      try {
        const audioBase64 = await blobToBase64(audio);
        transcript = await nova().transcribe(
          {
            audioBase64,
            mimeType: audio.type || "audio/webm",
            googleSttQuality: prefs.current.googleSttQuality,
          },
          prefs.current.sttProvider,
        );
      } catch {
        showError("Transcription failed");
        endTurn();
        return;
      }

      if (!transcript) {
        showError("Nothing heard");
        endTurn();
        return;
      }
      if (cancelledRef.current) {
        dispatch({ type: "dismiss" });
        return;
      }

      // Filter STT hallucinations from background noise/silence ("thanks for
      // watching", stray "you", etc.) and handle kill phrases ("stop", "that's
      // all", "thank you very much", ...) before ever calling Claude.
      const sanitized = sanitizeTranscript(transcript);
      if (!sanitized) {
        // Noise, not real speech — drop silently, no sound, no chat call.
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }
      if (isVoiceStopPhrase(sanitized)) {
        cue("gotIt");
        dispatch({ type: "dismiss" });
        // Stop listening, don't close the orb: a kill phrase is the user
        // actively engaging, not walking away, so a system-triggered popup
        // shouldn't auto-hide the way a natural turn completion would.
        nova().orbDisarmAutoHide();
        endTurn();
        return;
      }
      transcript = sanitized;

      dispatch({ type: "submit", transcript });
      dispatch({ type: "responseStart" });
      const id = `turn-${++reqId.current}`;

      const speaker = prefs.current.spokenReplies
        ? player.current.playStreaming({
            voice: prefs.current.ttsVoice,
            speed: prefs.current.ttsSpeed,
            hd: prefs.current.ttsHd,
            provider: prefs.current.ttsProvider,
            deepgramTtsVoice: prefs.current.deepgramTtsVoice,
            googleTtsVoice: prefs.current.googleTtsVoice,
            googleTtsQuality: prefs.current.googleTtsQuality,
          })
        : null;

      // Set to true when barge-in fires so the speaker.finish() .then() callback
      // knows not to call endTurn() / runTurn() (the new turn handles its own lifecycle).
      let bargeInFired = false;

      const barge = new TtsBargeInListener(
        ttsBargeInConfigFromSensitivity(prefs.current.bargeInSensitivity),
      );
      if (prefs.current.bargeInEnabled && speaker) {
        barge.start(stream, () => {
          bargeInFired = true;
          player.current.stop();
          nova().chatCancel(id);
          cue("bargeIn");
          dispatch({ type: "bargeIn" });
          void runTurn();
        });
      }

      let firstDelta = true;
      const offDelta = nova().onChatDelta((p) => {
        if (p.requestId !== id) return;
        if (firstDelta) {
          firstDelta = false;
          cue("reply"); // soft blip as the reply actually starts (thinking → speaking)
        }
        dispatch({ type: "responseDelta", delta: p.delta });
        speaker?.feed(p.delta);
      });

      const offTool = nova().onChatToolUse?.((p) => {
        if (p.requestId !== id) return;
        dispatch({ type: "startWorking", step: p.step });
      });

      const offDone = nova().onChatDone((p) => {
        if (p.requestId !== id) return;
        // Remove IPC listeners but intentionally keep the barge listener running:
        // TTS is still playing via speaker.finish() and the user should still be
        // able to interrupt. Barge is stopped after finish() resolves (or if barge
        // already fired, the guard below prevents double-completion).
        cleanupListeners();
        if (speaker) {
          void speaker.finish().then(() => {
            barge.stop();
            if (!bargeInFired) {
              dispatch({ type: "settle" });
              if (prefs.current.interactionMode === "conversation") {
                void runTurn();
              } else {
                endTurn();
              }
            }
          });
        } else {
          barge.stop();
          if (!bargeInFired) {
            dispatch({ type: "settle" });
            if (prefs.current.interactionMode === "conversation") {
              void runTurn();
            } else {
              endTurn();
            }
          }
        }
      });

      const offErr = nova().onChatError((p) => {
        if (p.requestId !== id) return;
        cleanup();
        showError(p.message ?? "Something went wrong");
        endTurn();
      });

      function cleanupListeners() {
        offDelta();
        offTool?.();
        offDone();
        offErr();
        cleanupTurn.current = null;
      }

      function cleanup() {
        cleanupListeners();
        barge.stop();
      }

      cleanupTurn.current = cleanup;

      nova().chatSend({
        requestId: id,
        messages: [{ role: "user", content: transcript }],
        inputModality: "voice",
      });
    }

    function endTurn() {
      setLevel(0);
      busyRef.current = false;
      nova().voiceTurnEnded();
    }

    return () => {
      cancelledRef.current = true;
      offWake();
      offPrefs?.();
      offTimer?.();
      stopWake?.();
      cleanupTurn.current?.();
      cleanupTurn.current = null;
      player.current.stop();
      mic.current.release();
    };
  }, []);

  return {
    state,
    level,
    sendText: (text: string) => sendTextRef.current(text),
  };
}
