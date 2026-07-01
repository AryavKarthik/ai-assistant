import { useEffect, useReducer, useRef, useState } from "react";
import { orbReducer, INITIAL_ORB_STATE } from "../orb/orb-machine";
import type { OrbState } from "../orb/orb-machine";
import { MicSession } from "../voice/mic-session";
import { MicAnalyser } from "../voice/mic-analyser";
import { TtsBargeInListener, ttsBargeInConfigFromSensitivity } from "../voice/tts-barge-in";
import { VoicePlayer } from "../voice/player";
import { startWakeCapture } from "../voice/wake-capture";
import { playEarcon } from "../voice/earcon";
import { nova } from "../lib/ipc";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

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
  const cleanupTurn = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let stopWake: (() => void) | null = null;

    async function boot() {
      prefs.current = await nova().getVoicePreferences();
      if (cancelledRef.current) return;
      const stream = await mic.current.acquire();
      if (cancelledRef.current) return;
      stopWake = startWakeCapture(stream, (buf) => nova().sendWakeFrame(buf));
    }
    void boot();

    // Listen for prefs updates pushed from main after Settings saves (added in Task 3+)
    const offPrefs = nova().onPrefsChanged?.((p: unknown) => {
      prefs.current = p as VoicePreferences;
    });

    const offWake = nova().onWakeDetected(() => {
      if (!cancelledRef.current) {
        if (prefs.current.instantAckMode === "earcon") void playEarcon();
        void runTurn();
      }
    });

    function showError(message: string) {
      dispatch({ type: "error", message });
      setTimeout(() => dispatch({ type: "dismiss" }), 2000);
    }

    async function runTurn() {
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
        audio = await recordUntilSilence(stream, prefs.current.silenceMs, (l) => setLevel(l));
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

      let transcript = "";
      try {
        const audioBase64 = await blobToBase64(audio);
        transcript = await nova().transcribe(
          { audioBase64, mimeType: audio.type || "audio/webm" },
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
          })
        : null;

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
            if (prefs.current.interactionMode === "conversation") {
              void runTurn();
            } else {
              endTurn();
            }
          });
        } else {
          dispatch({ type: "responseEnd" });
          if (prefs.current.interactionMode === "conversation") {
            void runTurn();
          } else {
            endTurn();
          }
        }
      });

      const offErr = nova().onChatError((p) => {
        if (p.requestId !== id) return;
        cleanup();
        showError(p.message ?? "Something went wrong");
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
      nova().voiceTurnEnded();
    }

    return () => {
      cancelledRef.current = true;
      offWake();
      offPrefs?.();
      stopWake?.();
      cleanupTurn.current?.();
      cleanupTurn.current = null;
      player.current.stop();
      mic.current.release();
    };
  }, []);

  return { state, level };
}
