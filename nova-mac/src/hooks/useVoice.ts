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
import { SpeechGate } from "../voice/vad";
import { nova } from "../lib/ipc";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

// No-speech giveup is configurable (VoicePreferences.noSpeechTimeoutMs,
// Settings → Conversation) — see recordUntilSilence.
const MAX_RECORDING_MS = 30_000;
/** Blobs smaller than this can't contain real speech — treat as silence. */
const MIN_SPEECH_BLOB_BYTES = 4_000;

/** Map listening sensitivity (0 strict … 1 sensitive) to the gate's minimum
 *  speech threshold — the noise-calibrated floor can only raise it. */
function speechThreshold(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return 0.14 - s * 0.09; // 0.14 (strict) … 0.05 (sensitive)
}

interface RecordResult {
  blob: Blob;
  /** Ambient noise floor measured this turn — remembered by MicSession so the
   *  next turn starts warm-calibrated. */
  noiseFloor: number;
}

/**
 * Records until the user stops talking, gated by a noise-calibrated
 * SpeechGate rather than a fixed threshold. The gate measures the room's
 * ambient level first and requires *sustained* speech-band energy above that
 * floor before anything counts as speech — a fan, HVAC hum, or a distant TV
 * no longer trips recording, which was the root of the "randomly replying to
 * things I'm not saying" behavior (the old fixed threshold treated any noisy
 * room as nonstop speech).
 */
async function recordUntilSilence(
  stream: MediaStream,
  options: {
    silenceMs: number;
    threshold: number;
    noSpeechTimeoutMs: number;
    initialNoiseFloor?: number;
  },
  onLevel: (level: number) => void,
): Promise<RecordResult> {
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
  const gate = new SpeechGate({
    minThreshold: options.threshold,
    // 260ms of sustained speech confirms — long enough to reject door slams
    // and keyboard clatter, short enough not to eat the first word.
    speechHoldMs: 260,
    initialNoiseFloor: options.initialNoiseFloor,
    // With a warm floor (idle ambient monitor / previous turn), skip in-gate
    // calibration — the user is typically already talking when this starts.
    calibrateMs: options.initialNoiseFloor ? 0 : undefined,
  });

  return new Promise((resolve) => {
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      analyser.stop();
      clearTimeout(silenceTimer ?? undefined);
      clearTimeout(noSpeechTimer);
      clearTimeout(maxTimer);
      const blob = new Blob(gate.confirmed ? chunks : [], { type: mimeType });
      const result: RecordResult = { blob, noiseFloor: gate.getNoiseFloor() };
      // If the user never spoke, resolve empty so the caller can show "Nothing heard"
      // without paying for a pointless STT round-trip.
      if (mr.state !== "inactive") {
        mr.onstop = () => resolve(result);
        try {
          mr.requestData();
          mr.stop();
        } catch {
          resolve(result);
        }
      } else {
        resolve(result);
      }
    }

    // If the user starts talking right at the no-speech deadline (the gate's
    // sustained-speech hold hasn't confirmed yet), extend instead of cutting
    // them off.
    let lastLoudAt = 0;
    function onNoSpeechDeadline() {
      if (gate.confirmed) return;
      if (Date.now() - lastLoudAt < 700) {
        noSpeechTimer = setTimeout(onNoSpeechDeadline, 1500);
        return;
      }
      finish();
    }
    let noSpeechTimer = setTimeout(onNoSpeechDeadline, options.noSpeechTimeoutMs);
    const maxTimer = setTimeout(finish, MAX_RECORDING_MS);

    analyser.start(stream, (level) => {
      onLevel(level);
      gate.push(level);
      // End-of-utterance uses the gate's RELEASE threshold (72% of trigger)
      // once speech is confirmed: trailing words are naturally quieter, and
      // comparing them against the full trigger threshold started the silence
      // timer while the user was still finishing their sentence — the "cuts
      // off the end of what I say" bug.
      const sounding = level >= (gate.confirmed ? gate.releaseThreshold() : gate.activeThreshold);
      if (sounding) {
        lastLoudAt = Date.now();
        if (silenceTimer !== null) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      } else if (gate.confirmed && silenceTimer === null) {
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
  /** Consecutive noise/empty listens in conversation mode — quietly re-listen
   *  a couple of times before giving up on the conversation. */
  const consecutiveNoiseTurns = useRef(0);
  const sendTextRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    cancelledRef.current = false;
    let stopWake: (() => void) | null = null;

    function cue(name: Parameters<typeof playCue>[0]) {
      if (prefs.current.audioCuesEnabled !== false) playCue(name);
    }

    // Idle ambient monitor: the mic is already open for wake capture, so keep
    // a rolling measurement of the room's speech-band level while no turn is
    // running. This is what calibrates listening — SpeechGate starts each turn
    // from this floor instead of guessing (or worse, calibrating on the user's
    // own first words).
    const idleAnalyser = new MicAnalyser();
    let idleSamples: number[] = [];

    async function boot() {
      prefs.current = await nova().getVoicePreferences();
      if (cancelledRef.current) return;
      const stream = await mic.current.acquire();
      if (cancelledRef.current) return;
      stopWake = startWakeCapture(stream, (buf) => nova().sendWakeFrame(buf));

      idleAnalyser.start(stream, (level) => {
        if (busyRef.current) {
          // Turn in progress (user speech / TTS): these levels are not ambient.
          idleSamples = [];
          return;
        }
        idleSamples.push(level);
        if (idleSamples.length >= 240) {
          // ~4s of idle audio; take the 60th percentile as the floor — robust
          // to brief one-off sounds without chasing them.
          const sorted = [...idleSamples].sort((a, b) => a - b);
          const floor = sorted[Math.floor(sorted.length * 0.6)] ?? 0;
          if (floor > 0) mic.current.rememberNoiseFloor(floor);
          idleSamples = [];
        }
      });
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
      const id = `text-${++reqId.current}`;

      // responseStart waits for the first streamed token: "processing"
      // (purple) is the visible state while Claude is thinking, and
      // "responding" (green) only once the reply actually starts.
      let firstDelta = true;
      const offDelta = nova().onChatDelta((p) => {
        if (p.requestId !== id) return;
        if (firstDelta) {
          firstDelta = false;
          dispatch({ type: "responseStart" });
        }
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

      // Kick off streaming STT concurrently (don't delay the VAD/recorder):
      // main tees the always-on wake-capture PCM frames into a Google
      // streaming recognizer, so transcription happens WHILE the user talks
      // and the transcript is ready ~instantly at silence. Attempted whenever
      // GCP voice is configured (main returns false otherwise) — the
      // sttProvider preference governs the batch fallback path, which
      // MediaRecorder keeps capturing for.
      const streamStartPromise: Promise<boolean> = nova()
        .sttStreamStart()
        .catch(() => false);

      let recording: RecordResult;
      try {
        recording = await recordUntilSilence(
          stream,
          {
            silenceMs: prefs.current.silenceMs,
            threshold: speechThreshold(prefs.current.listeningSensitivity),
            noSpeechTimeoutMs: prefs.current.noSpeechTimeoutMs,
            // Warm calibration: reuse the noise floor measured last turn so
            // the gate doesn't spend its calibration window re-learning the
            // same room (and can't be fooled by calibrating mid-sentence).
            initialNoiseFloor: mic.current.getNoiseFloor() || undefined,
          },
          (l) => setLevel(l),
        );
      } catch {
        nova().sttStreamAbort();
        showError("Recording failed");
        endTurn();
        return;
      }
      mic.current.rememberNoiseFloor(recording.noiseFloor);
      const audio = recording.blob;
      setLevel(0);
      if (cancelledRef.current) {
        nova().sttStreamAbort();
        dispatch({ type: "dismiss" });
        return;
      }

      // Too small to be real speech (gate never confirmed, or a split-second
      // blip): treat as silence. In conversation mode a quiet gap between
      // exchanges is normal — quietly listen again instead of erroring out of
      // the conversation.
      if (audio.size < MIN_SPEECH_BLOB_BYTES) {
        nova().sttStreamAbort();
        if (
          prefs.current.interactionMode === "conversation" &&
          consecutiveNoiseTurns.current < 2
        ) {
          consecutiveNoiseTurns.current++;
          void runTurn();
          return;
        }
        showError("Nothing heard");
        endTurn();
        return;
      }

      // Acknowledge that we heard them the moment recording closes.
      cue("gotIt");

      let transcript = "";
      const streamingStt = await streamStartPromise;
      if (streamingStt) {
        try {
          transcript = await nova().sttStreamStop();
        } catch {
          transcript = ""; // fall through to the batch path below
        }
      }
      if (!transcript) {
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
        // Noise, not real speech. In conversation mode, listen again rather
        // than silently dropping out of the conversation.
        if (
          prefs.current.interactionMode === "conversation" &&
          consecutiveNoiseTurns.current < 2
        ) {
          consecutiveNoiseTurns.current++;
          void runTurn();
          return;
        }
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }
      consecutiveNoiseTurns.current = 0;
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

      // Deliberately no responseStart here: the orb must stay "processing"
      // (purple) for the whole Claude round-trip. Dispatching responseStart
      // in the same tick as submit meant React batched blue→purple→green into
      // a single green paint — purple never showed and the orb sat green for
      // seconds before any speech, which read as plain broken.
      dispatch({ type: "submit", transcript });
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
          dispatch({ type: "responseStart" }); // purple → green only now
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
      nova().sttStreamAbort(); // idempotent — never leak a recognizer
      nova().voiceTurnEnded();
    }

    return () => {
      cancelledRef.current = true;
      offWake();
      offPrefs?.();
      offTimer?.();
      stopWake?.();
      idleAnalyser.stop();
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
