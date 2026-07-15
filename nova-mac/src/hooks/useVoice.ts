import { useEffect, useReducer, useRef, useState } from "react";
import { orbReducer, INITIAL_ORB_STATE } from "../orb/orb-machine";
import type { OrbState } from "../orb/orb-machine";
import { MicSession } from "../voice/mic-session";
import { MicAnalyser } from "../voice/mic-analyser";
import { TtsBargeInListener, ttsBargeInConfigFromSensitivity } from "../voice/tts-barge-in";
import { VoicePlayer } from "../voice/player";
import { startWakeCapture, getCaptureSampleRate } from "../voice/wake-capture";
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
    // Must outlive the silence window. The gate's default decay (2s) cleared
    // confirmed() BEFORE a silenceMs ≥ 2000 timer fired; a single ambient blip
    // after that cleared the silence timer, and with confirmed gone nothing
    // could ever re-arm it — recording ran to the 30s hard cap instead of
    // stopping after the configured silence ("listening never stops" bug).
    confirmedDecayMs: options.silenceMs + 2000,
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
    // them off — but only a couple of times. Unbounded extensions meant any
    // room with intermittent noise (each blip refreshing lastLoudAt) kept the
    // listen open way past the configured give-up time.
    let lastLoudAt = 0;
    let deadlineExtensions = 0;
    function onNoSpeechDeadline() {
      if (gate.confirmed) return;
      if (Date.now() - lastLoudAt < 700 && deadlineExtensions < 2) {
        deadlineExtensions++;
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
  /** True while any turn (voice or text) is streaming. */
  const busyRef = useRef(false);
  /** Consecutive noise/empty listens in conversation mode — quietly re-listen
   *  a couple of times before giving up on the conversation. */
  const consecutiveNoiseTurns = useRef(0);
  /** Rolling ~0.6s of native-rate PCM frames (from the capture worklet) used
   *  as pre-roll when a streaming STT session opens, so the first word after
   *  the wake phrase isn't clipped by the start round-trip. */
  const sttRing = useRef<ArrayBuffer[]>([]);
  /** True while native-rate frames should be forwarded to the live session. */
  const sttForward = useRef(false);
  const sendTextRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    // A local closure variable, NOT a ref: React 18 StrictMode (dev only)
    // mounts this effect, runs its cleanup, then mounts it again to check for
    // non-idempotent effects. A `useRef`-backed flag is shared across BOTH
    // invocations — the second invocation's reset-to-false at the top of this
    // same effect body un-cancels the FIRST (stale) invocation's still-pending
    // async boot(), since `cancelledRef.current` bounces back to false before
    // that stale chain's own `if (cancelledRef.current) return;` check runs.
    // The stale boot() then finishes and calls startWakeCapture() a SECOND
    // time on top of the real one — two concurrent wake-capture pipelines
    // both feeding frames into the wake engine, which is exactly the kind of
    // thing that shows up as "wake word inconsistent" in dev (`npm run dev`).
    // A `let` here is scoped to THIS invocation of the effect, so each
    // StrictMode cycle gets its own independent flag.
    let cancelled = false;
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
      if (cancelled) return;
      // Mic acquisition used to be a bare await: a denied/flaky microphone
      // rejected here as an unhandled promise, wake capture never started,
      // and nothing was ever shown — the app just looked like the wake word
      // "randomly doesn't work". Surface the failure and retry with backoff
      // (covers the user granting permission in System Settings after launch).
      let stream: MediaStream | null = null;
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          stream = await mic.current.acquire();
          break;
        } catch {
          if (attempt === 0) {
            showError(
              nova().platform === "win32"
                ? "Mic unavailable — enable microphone access in Settings → Privacy & security → Microphone"
                : "Mic unavailable — enable Nova in System Settings → Privacy & Security → Microphone",
            );
          }
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        }
      }
      if (!stream || cancelled) return;
      stopWake = startWakeCapture(
        stream,
        (buf) => nova().sendWakeFrame(buf),
        (buf) => {
          sttRing.current.push(buf);
          // ~1s of pre-roll (12 × 80ms). The barge-in probe depends on this
          // covering the WHOLE interrupting utterance: the listener needs
          // ~250-380ms of sustained speech before it even fires, so a short
          // kill word ("stop") is already over when the probe starts — only
          // the ring still has it.
          if (sttRing.current.length > 12) sttRing.current.shift();
          if (sttForward.current) nova().sttStreamAudio(buf);
        },
      );

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
      if (!cancelled) {
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

    // Proactive announcements pushed from main (reminder/calendar pre-alerts,
    // timer speech, agent-loop results). Queued behind any in-flight turn so
    // Nova never talks over itself, then spoken through the normal TTS player
    // with the orb in its green "speaking" state.
    const announceQueue: Array<import("@shared/types").ProactiveSpeakEvent> = [];
    let announcing = false;
    let announceRetry: ReturnType<typeof setTimeout> | null = null;

    async function drainAnnouncements() {
      if (announcing || cancelled) return;
      if (busyRef.current) {
        // A voice/text turn is running — try again shortly.
        announceRetry ??= setTimeout(() => {
          announceRetry = null;
          void drainAnnouncements();
        }, 1500);
        return;
      }
      const next = announceQueue.shift();
      if (!next) return;
      announcing = true;
      busyRef.current = true;
      let spoke = false;
      try {
        dispatch({ type: "announce", message: next.noticeText || null });
        if (next.speechText) {
          const speaker = player.current.playStreaming(ttsOptions());
          speaker.feed(next.speechText);
          try {
            await speaker.finish();
            spoke = true;
          } catch {
            // synth/playback failure — the notice is still on screen
          }
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: "announceEnd" });
          announcing = false;
          busyRef.current = false;
          if (spoke && prefs.current.interactionMode !== "off") {
            // Brief reply window: the user can answer the announcement
            // ("snooze it", "what's it about?") without saying the wake word.
            // The turn's own summon clears the lingering notice; if nothing is
            // said it quietly ends (which also lets the popup auto-hide).
            void runTurn({ followup: true, noSpeechMs: 3000 });
          } else {
            // Let the notice linger, then clear so the panel can tuck away —
            // unless a turn started in the meantime (never reset one mid-flight).
            if (next.noticeText) {
              setTimeout(() => {
                if (!busyRef.current) dispatch({ type: "dismiss" });
              }, 6000);
            } else {
              dispatch({ type: "dismiss" });
            }
            // Re-arms wake scoring (no-op if it wasn't paused) and lets main
            // auto-hide the popup it opened for this announcement.
            nova().voiceTurnEnded();
            void drainAnnouncements();
          }
        }
      }
    }

    const offProactive = nova().onProactiveSpeak?.((p) => {
      if (cancelled) return;
      announceQueue.push(p);
      void drainAnnouncements();
    });

    function abortSttStream() {
      sttForward.current = false;
      nova().sttStreamAbort();
    }

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

    // `followup: true` means this is a continuation of an ongoing conversation
    // (re-listen right after a reply) rather than a fresh wake — it waits a bit
    // less for speech and ends quietly (back to sleep) if nothing comes.
    // `noSpeechMs` overrides the give-up window (used for the short reply
    // window after a proactive announcement).
    async function runTurn(opts?: { followup?: boolean; noSpeechMs?: number }) {
      // A fresh wake starts a fresh conversation: the noise-turn counter must
      // not carry over from the previous conversation's ending. Stale state
      // here made a new "Hey Jarvis" activation dismiss itself on the first
      // quiet moment (counter already at its limit) — one flavor of
      // "the wake word only works sometimes".
      if (!opts?.followup) consecutiveNoiseTurns.current = 0;
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
      if (cancelled) {
        dispatch({ type: "dismiss" });
        return;
      }

      // Kick off streaming STT concurrently (don't delay the VAD/recorder):
      // the capture worklet's native-rate PCM frames stream to Google so
      // transcription happens WHILE the user talks — at full mic fidelity, no
      // resampling — and the transcript is ready ~instantly at silence.
      // Attempted whenever GCP voice is configured (main returns false
      // otherwise); the sttProvider preference governs the batch fallback
      // path, which MediaRecorder keeps capturing for.
      const streamStartPromise: Promise<boolean> = (async () => {
        const sampleRateHertz = getCaptureSampleRate();
        if (!sampleRateHertz) return false; // capture fell back to wake-only mode
        const ok = await nova()
          .sttStreamStart({ sampleRateHertz })
          .catch(() => false);
        if (ok && !cancelled) {
          // Pre-roll, then live: the ring holds only pre-start frames and this
          // flush is synchronous, so ordering to Google stays monotonic.
          for (const f of sttRing.current) nova().sttStreamAudio(f);
          sttForward.current = true;
        }
        return ok;
      })();

      let recording: RecordResult;
      try {
        recording = await recordUntilSilence(
          stream,
          {
            silenceMs: prefs.current.silenceMs,
            threshold: speechThreshold(prefs.current.listeningSensitivity),
            // Shorter give-up window mid-conversation so it drops back to sleep
            // promptly when you're actually done, without cutting off a first
            // wake utterance.
            noSpeechTimeoutMs:
              opts?.noSpeechMs ?? (opts?.followup ? 4000 : prefs.current.noSpeechTimeoutMs),
            // Warm calibration: reuse the noise floor measured last turn so
            // the gate doesn't spend its calibration window re-learning the
            // same room (and can't be fooled by calibrating mid-sentence).
            initialNoiseFloor: mic.current.getNoiseFloor() || undefined,
          },
          (l) => setLevel(l),
        );
      } catch {
        abortSttStream();
        showError("Recording failed");
        endTurn();
        return;
      }
      mic.current.rememberNoiseFloor(recording.noiseFloor);
      const audio = recording.blob;
      setLevel(0);
      if (cancelled) {
        abortSttStream();
        dispatch({ type: "dismiss" });
        return;
      }

      // Too small to be real speech (gate never confirmed, or a split-second
      // blip): treat as silence. In conversation mode a quiet gap between
      // exchanges is normal — quietly listen again instead of erroring out of
      // the conversation.
      if (audio.size < MIN_SPEECH_BLOB_BYTES) {
        abortSttStream();
        if (consecutiveNoiseTurns.current < 2) {
          // A blip or a quiet gap — listen again rather than bailing.
          consecutiveNoiseTurns.current++;
          void runTurn({ followup: true });
          return;
        }
        // Genuinely nothing — conversation's over. Quietly go back to sleep,
        // no error sound/text (that read as babying).
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }

      // Acknowledge that we heard them the moment recording closes.
      cue("gotIt");

      let transcript = "";
      const streamingStt = await streamStartPromise;
      if (streamingStt) {
        sttForward.current = false;
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
        // Quiet end — no "nothing heard" error.
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }
      if (cancelled) {
        dispatch({ type: "dismiss" });
        return;
      }

      // The STT pre-roll can catch the tail of the wake phrase — drop a
      // leading "(hey) Jarvis" so it never reaches Claude as part of the ask.
      transcript = transcript
        .replace(/^\s*(?:hey|hi|ok|okay)?[,\s]*jarvis\b[,.!?\s]*/i, "")
        .trim();
      if (!transcript) {
        // Wake word alone — nothing to do, just listen ending.
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }

      // Filter STT hallucinations from background noise/silence ("thanks for
      // watching", stray "you", etc.) and handle kill phrases ("stop", "that's
      // all", "thank you very much", ...) before ever calling Claude.
      const sanitized = sanitizeTranscript(transcript);
      if (!sanitized) {
        // Noise/hallucination, not real speech — listen again rather than
        // dropping the conversation.
        if (consecutiveNoiseTurns.current < 2) {
          consecutiveNoiseTurns.current++;
          void runTurn({ followup: true });
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

      startReply(transcript, stream);
    }

    function ttsOptions() {
      return {
        voice: prefs.current.ttsVoice,
        speed: prefs.current.ttsSpeed,
        hd: prefs.current.ttsHd,
        provider: prefs.current.ttsProvider,
        deepgramTtsVoice: prefs.current.deepgramTtsVoice,
        googleTtsVoice: prefs.current.googleTtsVoice,
        googleTtsQuality: prefs.current.googleTtsQuality,
      };
    }

    // Sends `transcript` to Claude and speaks the streamed reply. Handles
    // barge-in with a probe: an interrupt pauses the reply and listens; only a
    // real follow-up utterance starts a new turn — if nothing (or just noise)
    // is heard, it RESUMES speaking the reply it was giving instead of
    // dropping it.
    function startReply(transcript: string, stream: MediaStream) {
      // Orb stays "processing" (purple) until the first token; see the
      // earlier note on React batching blue→purple→green.
      dispatch({ type: "submit", transcript });
      const id = `turn-${++reqId.current}`;

      const currentSpeaker = prefs.current.spokenReplies
        ? player.current.playStreaming(ttsOptions())
        : null;
      // Accumulated so a false barge-in (see onBarge) can re-speak the reply
      // instead of just dropping it.
      let replyText = "";
      // Once a barge-in commits to a new turn (or a stop phrase), the original
      // turn's completion path must not also end/re-listen.
      let bargeCommitted = false;
      let barge: TtsBargeInListener | null = null;

      function armBarge() {
        if (!(prefs.current.bargeInEnabled && prefs.current.spokenReplies)) return;
        barge = new TtsBargeInListener(
          ttsBargeInConfigFromSensitivity(prefs.current.bargeInSensitivity),
        );
        barge.start(stream, onBarge);
      }

      function finishTurn() {
        dispatch({ type: "settle" });
        // Keep the conversation flowing: after every reply, listen for a
        // follow-up. "Hey Jarvis" opens the conversation; it stays open
        // turn-to-turn and only drops back to sleep when you fall silent (or
        // say a kill word). Wake word ↔ conversation are interlinked, not
        // either/or.
        void runTurn({ followup: true });
      }

      // Interrupt handling. An interrupt stops the reply and listens briefly:
      // real follow-up speech starts a new turn; a kill word ends the turn;
      // otherwise (silence, or just noise — no actual follow-up) it RESUMES
      // speaking the reply it was giving. The resume dispatches submit→
      // responseStart, the same valid bargeIn→processing→responding path a
      // fresh reply already uses — dispatching responseStart directly from
      // bargeIn (skipping submit) is a no-op in the reducer and is what froze
      // the orb orange in an earlier version of this.
      async function onBarge() {
        if (bargeCommitted) return;
        bargeCommitted = true;
        barge?.stop();
        cleanupListeners();
        player.current.stop();
        nova().chatCancel(id);
        cue("bargeIn");
        dispatch({ type: "bargeIn" });

        // Streaming STT with the sttRing pre-roll, exactly like a main turn.
        // This is NOT an optimization here — it's what lets a short kill word
        // be heard at all. The barge listener needs ~250-380ms of sustained
        // speech before this function even runs, so by the time the probe's
        // recorder starts, "stop" / "that's all" is usually already finished:
        // the batch path below hears silence, the probe read as a false
        // alarm, and Nova RESUMED the reply and re-listened — the "keeps
        // listening after a kill word" bug. The ring holds the last ~1s of
        // PCM, which contains the interrupting utterance itself.
        const probeStreamPromise: Promise<boolean> = (async () => {
          const sampleRateHertz = getCaptureSampleRate();
          if (!sampleRateHertz) return false;
          const ok = await nova()
            .sttStreamStart({ sampleRateHertz })
            .catch(() => false);
          if (ok && !cancelled) {
            for (const f of sttRing.current) nova().sttStreamAudio(f);
            sttForward.current = true;
          }
          return ok;
        })();

        let probe: RecordResult | null = null;
        try {
          probe = await recordUntilSilence(
            stream,
            {
              silenceMs: prefs.current.silenceMs,
              threshold: speechThreshold(prefs.current.listeningSensitivity),
              noSpeechTimeoutMs: 1500,
              initialNoiseFloor: mic.current.getNoiseFloor() || undefined,
            },
            (l) => setLevel(l),
          );
        } catch {
          probe = null;
        }
        setLevel(0);
        if (cancelled) {
          abortSttStream();
          dispatch({ type: "dismiss" });
          return;
        }

        let s = "";
        if (await probeStreamPromise) {
          sttForward.current = false;
          try {
            s = sanitizeTranscript(await nova().sttStreamStop());
          } catch {
            s = "";
            abortSttStream(); // never leak a recognizer into the resume path
          }
        }
        if (!s && probe && probe.blob.size >= MIN_SPEECH_BLOB_BYTES) {
          try {
            const t = await nova().transcribe(
              {
                audioBase64: await blobToBase64(probe.blob),
                mimeType: probe.blob.type || "audio/webm",
                googleSttQuality: prefs.current.googleSttQuality,
              },
              prefs.current.sttProvider,
            );
            s = sanitizeTranscript(t);
          } catch {
            s = "";
          }
        }

        if (s && !isVoiceStopPhrase(s)) {
          // Real interruption — dispatch stays orange until submit flips it to
          // processing inside startReply.
          startReply(s, stream);
          return;
        }
        if (s && isVoiceStopPhrase(s)) {
          // Kill word during a barge — conversation's over. Go idle.
          cue("gotIt");
          nova().orbDisarmAutoHide();
          dispatch({ type: "dismiss" });
          endTurn();
          return;
        }

        // False alarm — no real follow-up (silence or just noise). Resume
        // speaking the reply instead of dropping it.
        const toSay = replyText.trim();
        if (!toSay || !prefs.current.spokenReplies) {
          dispatch({ type: "dismiss" });
          endTurn();
          return;
        }
        // bargeIn → processing → responding, via the same transitions a fresh
        // reply uses (see the note above onBarge).
        dispatch({ type: "submit", transcript });
        dispatch({ type: "responseStart" });
        dispatch({ type: "responseDelta", delta: toSay });
        const resumeSpeaker = player.current.playStreaming(ttsOptions());
        resumeSpeaker.feed(toSay);
        // Re-arm barge-in for the resumed playback: without this, a kill word
        // (or any interrupt) spoken while the resumed reply plays fell on deaf
        // ears until the next listen window — the second half of the "keeps
        // going after I said stop" bug. Resetting bargeCommitted lets onBarge
        // run again for this playback; the finishTurn below is skipped when a
        // re-barge commits so the interrupt path owns the turn from there.
        bargeCommitted = false;
        armBarge();
        try {
          await resumeSpeaker.finish();
        } catch {
          // best effort — still settle below either way
        }
        barge?.stop();
        if (cancelled) {
          dispatch({ type: "dismiss" });
          return;
        }
        if (!bargeCommitted) finishTurn();
      }

      let firstDelta = true;
      const offDelta = nova().onChatDelta((p) => {
        if (p.requestId !== id) return;
        if (firstDelta) {
          firstDelta = false;
          cue("reply"); // soft blip as the reply actually starts (thinking → speaking)
          dispatch({ type: "responseStart" }); // purple → green only now
          // Arm barge-in HERE, not at the top of startReply. The listener's
          // cooldown window (~750-1100ms) calibrates its "ambient" baseline
          // from whatever the mic hears while it counts down, then judges
          // anything louder than that baseline as a barge-in. Arming it the
          // instant the network call is sent means that whole window elapses
          // during the silent "thinking" phase (model latency is often
          // 1-3s+) — baseline calibrates to a SILENT room, the cooldown
          // expires before TTS ever makes a sound, and then the first bit of
          // the AI's own voice (which leaks into the mic at least partially
          // even with echo cancellation) reads as a huge spike over that
          // near-zero baseline and immediately self-triggers a "barge-in" —
          // the AI interrupting itself, repeatedly, on its own voice. Arming
          // it right as real speech starts means the calibration window
          // instead measures the TTS's own bleed-through as "ambient," so a
          // genuine interruption has to be louder than the AI's own voice on
          // top of that baseline to register — which is what barge-in is
          // actually supposed to detect.
          armBarge();
        }
        replyText += p.delta;
        dispatch({ type: "responseDelta", delta: p.delta });
        currentSpeaker?.feed(p.delta);
      });

      const offTool = nova().onChatToolUse?.((p) => {
        if (p.requestId !== id) return;
        dispatch({ type: "startWorking", step: p.step });
      });

      const offDone = nova().onChatDone((p) => {
        if (p.requestId !== id) return;
        // Remove IPC listeners but keep the barge listener running: TTS is
        // still playing via finish() and the user may still interrupt.
        cleanupListeners();
        if (currentSpeaker) {
          void currentSpeaker.finish().then(() => {
            barge?.stop();
            if (!bargeCommitted) finishTurn();
          });
        } else {
          barge?.stop();
          if (!bargeCommitted) finishTurn();
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
        barge?.stop();
      }

      cleanupTurn.current = cleanup;
      // armBarge() is called from offDelta's firstDelta branch above, once
      // real speech actually starts — see the comment there.

      nova().chatSend({
        requestId: id,
        messages: [{ role: "user", content: transcript }],
        inputModality: "voice",
      });
    }

    function endTurn() {
      setLevel(0);
      busyRef.current = false;
      abortSttStream(); // idempotent — never leak a recognizer
      nova().voiceTurnEnded();
      // Announcements that queued up while this turn ran can go out now.
      void drainAnnouncements();
    }

    return () => {
      cancelled = true;
      offWake();
      offPrefs?.();
      offTimer?.();
      offProactive?.();
      if (announceRetry) clearTimeout(announceRetry);
      stopWake?.();
      idleAnalyser.stop();
      cleanupTurn.current?.();
      cleanupTurn.current = null;
      player.current.stop();
      mic.current.release();
      // Safety net: if a turn (or a multi-turn conversation, which no longer
      // calls endTurn() between exchanges) was in flight when this unmounts,
      // main's wake engine would otherwise stay paused forever with no other
      // signal ever telling it to resume. Both calls are idempotent/no-ops
      // when nothing was in progress.
      abortSttStream();
      nova().voiceTurnEnded();
    };
  }, []);

  return {
    state,
    level,
    sendText: (text: string) => sendTextRef.current(text),
  };
}
