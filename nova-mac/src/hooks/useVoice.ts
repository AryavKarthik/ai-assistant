import { useEffect, useReducer, useRef, useState } from "react";
import { orbReducer, INITIAL_ORB_STATE } from "../orb/orb-machine";
import type { OrbState } from "../orb/orb-machine";
import { MicSession } from "../voice/mic-session";
import { MicAnalyser } from "../voice/mic-analyser";
import { TtsBargeInListener, ttsBargeInConfigFromSensitivity } from "../voice/tts-barge-in";
import { VoicePlayer } from "../voice/player";
import { startWakeCapture } from "../voice/wake-capture";
import { nova } from "../lib/ipc";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

/** Record from a MediaStream until silence is detected, returning the captured Blob. */
async function recordUntilSilence(
  stream: MediaStream,
  silenceMs: number,
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
      if (mr.state !== "inactive") {
        mr.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        try {
          mr.requestData();
          mr.stop();
        } catch {
          resolve(new Blob(chunks, { type: mimeType }));
        }
      } else {
        resolve(new Blob(chunks, { type: mimeType }));
      }
    }

    analyser.start(stream, (level) => {
      onLevel(level);
      if (level > 0.1) {
        speechSeen = true;
        if (silenceTimer !== null) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      } else if (speechSeen && silenceTimer === null) {
        silenceTimer = setTimeout(finish, silenceMs);
      }
    });

    // Watchdog: max 30 seconds
    setTimeout(finish, 30_000);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin);
}

export function useVoice(): { state: OrbState; level: number } {
  const [state, dispatch] = useReducer(orbReducer, INITIAL_ORB_STATE);
  const [level, setLevel] = useState(0);

  const mic = useRef(new MicSession());
  const player = useRef(new VoicePlayer());
  const prefs = useRef<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const reqId = useRef(0);

  // Cleanup ref for the current turn's IPC listeners and barge-in listener
  const cleanupTurn = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopWake: (() => void) | null = null;

    async function boot() {
      prefs.current = await nova().getVoicePreferences();
      if (cancelled) return;
      const stream = await mic.current.acquire();
      if (cancelled) return;
      stopWake = startWakeCapture(stream, (buf) => nova().sendWakeFrame(buf));
    }
    void boot();

    const offWake = nova().onWakeDetected(() => {
      if (!cancelled) void runTurn();
    });

    async function runTurn() {
      // Clean up any prior turn's listeners
      cleanupTurn.current?.();
      cleanupTurn.current = null;

      dispatch({ type: "summon" });

      let stream: MediaStream;
      try {
        stream = await mic.current.acquire();
      } catch {
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }
      if (cancelled) {
        dispatch({ type: "dismiss" });
        return;
      }

      // 1) Record the command until silence
      let audio: Blob;
      try {
        audio = await recordUntilSilence(
          stream,
          prefs.current.silenceMs,
          (l) => setLevel(l),
        );
      } catch {
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }
      setLevel(0);

      if (cancelled) {
        dispatch({ type: "dismiss" });
        return;
      }

      // 2) STT via IPC
      let transcript = "";
      try {
        const audioBase64 = await blobToBase64(audio);
        transcript = await nova().transcribe(
          { audioBase64, mimeType: audio.type || "audio/webm" },
          prefs.current.sttProvider,
        );
      } catch {
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }

      if (!transcript) {
        dispatch({ type: "dismiss" });
        endTurn();
        return;
      }

      if (cancelled) {
        dispatch({ type: "dismiss" });
        return;
      }

      dispatch({ type: "submit", transcript });

      // 3) Stream the reply → drive orb + sentence-by-sentence TTS
      dispatch({ type: "responseStart" });
      const id = `turn-${++reqId.current}`;

      const speaker = prefs.current.spokenReplies
        ? player.current.playStreaming({
            voice: prefs.current.ttsVoice,
            speed: prefs.current.ttsSpeed,
            hd: prefs.current.ttsHd,
            provider: prefs.current.ttsProvider,
            deepgramTtsVoice: prefs.current.deepgramTtsVoice,
          })
        : null;

      // Barge-in: interrupt playback when the user speaks over the reply
      const barge = new TtsBargeInListener(
        ttsBargeInConfigFromSensitivity(prefs.current.bargeInSensitivity),
      );
      if (prefs.current.bargeInEnabled && speaker) {
        barge.start(stream, () => {
          player.current.stop();
          nova().chatCancel(id);
          dispatch({ type: "bargeIn" });
          void runTurn();
        });
      }

      const offDelta = nova().onChatDelta((p) => {
        if (p.requestId !== id) return;
        dispatch({ type: "responseDelta", delta: p.delta });
        speaker?.feed(p.delta);
      });

      const offDone = nova().onChatDone((p) => {
        if (p.requestId !== id) return;
        cleanup();
        if (speaker) {
          void speaker.finish().then(() => {
            dispatch({ type: "responseEnd" });
            endTurn();
          });
        } else {
          dispatch({ type: "responseEnd" });
          endTurn();
        }
      });

      const offErr = nova().onChatError((p) => {
        if (p.requestId !== id) return;
        cleanup();
        dispatch({ type: "error", message: p.message });
        endTurn();
      });

      function cleanup() {
        offDelta();
        offDone();
        offErr();
        barge.stop();
        cleanupTurn.current = null;
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
      nova().voiceTurnEnded(); // tell main to re-arm wake scoring
    }

    return () => {
      cancelled = true;
      offWake();
      stopWake?.();
      cleanupTurn.current?.();
      cleanupTurn.current = null;
      player.current.stop();
      mic.current.release();
    };
  }, []);

  return { state, level };
}
