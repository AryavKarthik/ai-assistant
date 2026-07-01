# Nova Mac Plan 4 — Conversation Polish + Full UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Nova Mac from a bare tray orb to a fully-featured companion app with fixed barge-in, canvas orb matching the web app, Apple liquid glass aesthetics, text input, and a full expanded-window UI with Reminders, Memory, Connections, and Settings tabs.

**Architecture:** Two-mode window model — compact orb (480×600, always-on-top, frameless, no Dock) for voice interaction, expanded app window (920×680, vibrancy, Dock icon) for tab navigation. Single renderer bundle detects window mode via `nova().getWindowMode()` and renders either `<App />` (orb) or `<AppShell />` (expanded). All API keys stay in the main process.

**Tech Stack:** Electron + React 19 + framer-motion, Tailwind CSS (renderer only), @tabler/icons-react, Supabase for persistence, Anthropic for chat, OpenAI for STT/TTS.

## Global Constraints

- API keys stay in main process — never cross to renderer via IPC
- Never `select("embedding")` on `memories` table (6 KB floats per row)
- `nova://auth-callback` → auth handler; `nova://connections-callback` → connections token exchange (single `open-url` handler in `main.ts`, branched by URL)
- Orb window hides (`win.hide()`) when app window opens — never `win.close()`
- Tailwind only in renderer (`nova-mac/src/`) — main/preload bundles unchanged
- `PrefsChanged` push IPC: after any pref save, main broadcasts to ALL windows so orb `useVoice.ts` stays in sync
- Google OAuth PKCE required for native app flow — store `code_verifier` in module-level Map keyed by `state` param
- Working directory: `nova-mac/`
- Build gate: `npm run build` (tsc + electron-vite)
- Test gate: `npm test` (vitest)

---

### Task 1: Voice Polish — Barge-in fix, earcon, continuous conversation, error states

**Files:**
- Modify: `src/voice/mic-analyser.ts`
- Modify: `src/hooks/useVoice.ts`
- Modify: `src/orb/orb-machine.ts`
- Modify: `shared/types.ts`

**Interfaces:**
- Produces: `useVoice` returns `{ state: OrbState; level: number }` — unchanged signature, but state transitions now include proper error messages and bargeIn phase

---

- [ ] **Step 1: Fix AudioContext suspension in MicAnalyser**

`src/voice/mic-analyser.ts` — add `audioContext.resume()` after creation so barge-in listener works during TTS:

```typescript
import { measureSpeechBandLevel } from "./vad";

export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export async function openMicStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  } catch {
    throw new Error("Microphone permission denied.");
  }
}

export class MicAnalyser {
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private disposed = false;

  start(stream: MediaStream, onLevel: (level: number) => void): void {
    this.stopLoop();
    this.disposed = false;

    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
    }

    // Resume suspended context (common after user gesture / TTS plays)
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }

    const ctx = this.audioContext;
    this.source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    this.source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (this.disposed) return;
      analyser.getByteFrequencyData(data);
      onLevel(measureSpeechBandLevel(data));
      this.raf = requestAnimationFrame(tick);
    };

    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.stopLoop();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private stopLoop(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.source?.disconnect();
    this.source = null;
  }
}
```

- [ ] **Step 2: Add earcon audio utility**

Create `src/voice/earcon.ts`:

```typescript
// ~80ms 440 Hz sine tone encoded as base64 WAV for instant ack feedback
const EARCON_WAV_B64 =
  "UklGRlQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YTAAAAC" +
  "AgICAgICAgIB/fn18e3p5eHd2dXRzcnFwb25tbGtqaWhnZmVkY2JhYF9eXVxbWllYV1ZVVFNSUVBPUE9OTUxLSklIR0ZFRENCQUA/Pj08Ozk4NzY1NDMyMTAvLi0sKyopKCcmJSQjIiEgHx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQ==";

let _earconBuffer: AudioBuffer | null = null;
let _earconCtx: AudioContext | null = null;

export async function playEarcon(): Promise<void> {
  try {
    if (!_earconCtx || _earconCtx.state === "closed") {
      _earconCtx = new AudioContext();
    }
    if (_earconCtx.state === "suspended") await _earconCtx.resume();

    if (!_earconBuffer) {
      const raw = atob(EARCON_WAV_B64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      _earconBuffer = await _earconCtx.decodeAudioData(bytes.buffer);
    }

    const src = _earconCtx.createBufferSource();
    src.buffer = _earconBuffer;
    src.connect(_earconCtx.destination);
    src.start();
  } catch {
    // earcon is best-effort
  }
}
```

- [ ] **Step 3: Add `bargeIn` phase to OrbStateName in shared/types.ts**

```typescript
export type OrbStateName =
  | "dormant"
  | "listening"
  | "processing"
  | "responding"
  | "working"
  | "bargeIn";
```

- [ ] **Step 4: Update orb-machine to use new `bargeIn` state name**

`src/orb/orb-machine.ts` — change `bargeIn` event handler to produce `name: "bargeIn"` (matching the new type):

```typescript
import type { OrbStateName } from "@shared/types";

export interface OrbState {
  name: OrbStateName;
  transcript: string;
  responseText: string;
  workingStep: string | null;
  error: string | null;
}

export type OrbEvent =
  | { type: "summon" }
  | { type: "submit"; transcript: string }
  | { type: "responseStart" }
  | { type: "responseDelta"; delta: string }
  | { type: "responseEnd" }
  | { type: "bargeIn" }
  | { type: "startWorking"; step: string }
  | { type: "workingStep"; step: string }
  | { type: "stop" }
  | { type: "dismiss" }
  | { type: "error"; message: string };

export const INITIAL_ORB_STATE: OrbState = {
  name: "dormant",
  transcript: "",
  responseText: "",
  workingStep: null,
  error: null,
};

export function orbReducer(state: OrbState, event: OrbEvent): OrbState {
  switch (event.type) {
    case "summon":
      return state.name === "dormant"
        ? { ...INITIAL_ORB_STATE, name: "listening" }
        : state;

    case "submit":
      return state.name === "listening"
        ? { ...state, name: "processing", transcript: event.transcript, error: null }
        : state;

    case "responseStart":
      return state.name === "processing"
        ? { ...state, name: "responding", responseText: "" }
        : state;

    case "responseDelta":
      return state.name === "responding"
        ? { ...state, responseText: state.responseText + event.delta }
        : state;

    case "responseEnd":
      return state.name === "responding"
        ? { ...INITIAL_ORB_STATE, name: "dormant" }
        : state;

    case "bargeIn":
      return state.name === "responding"
        ? { ...INITIAL_ORB_STATE, name: "bargeIn" }
        : state;

    case "startWorking":
      return { ...state, name: "working", workingStep: event.step };

    case "workingStep":
      return state.name === "working" ? { ...state, workingStep: event.step } : state;

    case "stop":
      return state.name === "working" ? { ...state, name: "responding" } : state;

    case "dismiss":
      return INITIAL_ORB_STATE;

    case "error":
      return { ...INITIAL_ORB_STATE, name: "dormant", error: event.message };
  }
}
```

- [ ] **Step 5: Rewrite useVoice.ts with barge-in fix, earcon, continuous conversation, and error states**

`src/hooks/useVoice.ts`:

```typescript
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
  mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
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
        try { mr.requestData(); mr.stop(); } catch {
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
        if (silenceTimer !== null) { clearTimeout(silenceTimer); silenceTimer = null; }
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

    // Listen for prefs updates pushed from main (after Settings saves)
    const offPrefs = nova().onPrefsChanged?.((p: VoicePreferences) => {
      prefs.current = p;
    });

    const offWake = nova().onWakeDetected(() => {
      if (!cancelledRef.current) {
        if (prefs.current.instantAckMode === "earcon") void playEarcon();
        void runTurn();
      }
    });

    async function runTurn() {
      cleanupTurn.current?.();
      cleanupTurn.current = null;

      dispatch({ type: "summon" });

      let stream: MediaStream;
      try {
        stream = await mic.current.acquire();
      } catch {
        dispatch({ type: "error", message: "Mic unavailable" });
        setTimeout(() => dispatch({ type: "dismiss" }), 2000);
        endTurn();
        return;
      }
      if (cancelledRef.current) { dispatch({ type: "dismiss" }); return; }

      let audio: Blob;
      try {
        audio = await recordUntilSilence(stream, prefs.current.silenceMs, (l) => setLevel(l));
      } catch {
        dispatch({ type: "error", message: "Recording failed" });
        setTimeout(() => dispatch({ type: "dismiss" }), 2000);
        endTurn();
        return;
      }
      setLevel(0);
      if (cancelledRef.current) { dispatch({ type: "dismiss" }); return; }

      let transcript = "";
      try {
        const audioBase64 = await blobToBase64(audio);
        transcript = await nova().transcribe(
          { audioBase64, mimeType: audio.type || "audio/webm" },
          prefs.current.sttProvider,
        );
      } catch {
        dispatch({ type: "error", message: "Transcription failed" });
        setTimeout(() => dispatch({ type: "dismiss" }), 2000);
        endTurn();
        return;
      }

      if (!transcript) {
        dispatch({ type: "error", message: "Nothing heard" });
        setTimeout(() => dispatch({ type: "dismiss" }), 2000);
        endTurn();
        return;
      }
      if (cancelledRef.current) { dispatch({ type: "dismiss" }); return; }

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
        dispatch({ type: "error", message: p.message });
        setTimeout(() => dispatch({ type: "dismiss" }), 2000);
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
```

- [ ] **Step 6: Run build to verify no type errors**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors (electron-vite build completes)

- [ ] **Step 7: Run tests**

```bash
cd nova-mac && npm test 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
cd nova-mac && git add src/voice/mic-analyser.ts src/voice/earcon.ts src/hooks/useVoice.ts src/orb/orb-machine.ts shared/types.ts
git commit -m "feat(mac): voice polish — fix barge-in AudioContext suspension, earcon ack, continuous conversation, error states"
```

---

### Task 2: Canvas Orb (VoiceOrb port)

**Files:**
- Create: `src/components/orb/VoiceOrb.tsx`
- Modify: `src/components/orb/Orb.tsx`

**Interfaces:**
- Consumes: `OrbState` from `src/orb/orb-machine.ts`; `OrbStateName` from `shared/types.ts`
- Produces: `<VoiceOrb visualMode={...} audioLevel={...} />` used by `Orb.tsx`

---

- [ ] **Step 1: Create VoiceOrb canvas component**

Create `src/components/orb/VoiceOrb.tsx` — exact port of `components/voice/VoiceOrb.tsx` from the web app (no `"use client"` directive needed in Electron renderer):

```typescript
import { memo, useEffect, useRef } from "react";

export type VoiceVisualMode =
  | "idle"
  | "listening"
  | "barge_in"
  | "processing"
  | "thinking"
  | "speaking";

interface VoiceOrbProps {
  visualMode: VoiceVisualMode;
  audioLevel: number;
}

const PALETTES: Record<
  VoiceVisualMode,
  { core: string; mid: string; rim: string; glow: string; speed: number }
> = {
  idle: {
    core: "rgba(220, 220, 228, 0.35)",
    mid: "rgba(90, 90, 100, 0.22)",
    rim: "rgba(255, 255, 255, 0.18)",
    glow: "rgba(255, 255, 255, 0.05)",
    speed: 0.01,
  },
  listening: {
    core: "rgba(255, 255, 255, 0.92)",
    mid: "rgba(200, 210, 255, 0.45)",
    rim: "rgba(147, 197, 253, 0.75)",
    glow: "rgba(96, 165, 250, 0.22)",
    speed: 0.022,
  },
  barge_in: {
    core: "rgba(255, 236, 180, 0.95)",
    mid: "rgba(251, 191, 36, 0.5)",
    rim: "rgba(251, 191, 36, 0.85)",
    glow: "rgba(245, 158, 11, 0.28)",
    speed: 0.034,
  },
  processing: {
    core: "rgba(230, 230, 235, 0.8)",
    mid: "rgba(160, 160, 175, 0.4)",
    rim: "rgba(255, 255, 255, 0.45)",
    glow: "rgba(255, 255, 255, 0.1)",
    speed: 0.04,
  },
  thinking: {
    core: "rgba(210, 200, 255, 0.85)",
    mid: "rgba(167, 139, 250, 0.42)",
    rim: "rgba(196, 181, 253, 0.7)",
    glow: "rgba(139, 92, 246, 0.2)",
    speed: 0.018,
  },
  speaking: {
    core: "rgba(190, 255, 220, 0.9)",
    mid: "rgba(52, 211, 153, 0.42)",
    rim: "rgba(74, 222, 128, 0.75)",
    glow: "rgba(16, 185, 129, 0.24)",
    speed: 0.026,
  },
};

export const VoiceOrb = memo(function VoiceOrb({ visualMode, audioLevel }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(audioLevel);
  const modeRef = useRef(visualMode);

  useEffect(() => { levelRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { modeRef.current = visualMode; }, [visualMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let phase = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.34;
      const level = levelRef.current;
      const mode = modeRef.current;
      const palette = PALETTES[mode];
      const reactive = mode === "listening" || mode === "barge_in" || mode === "processing";

      phase += palette.speed + (reactive ? level * 0.05 : 0) + (mode === "thinking" ? 0.006 : 0);
      ctx.clearRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(cx, cy, baseR * 0.15, cx, cy, baseR * 1.45);
      glow.addColorStop(0, palette.glow);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const blobCount = mode === "processing" ? 2 : 3;
      for (let i = 0; i < blobCount; i++) {
        const t = phase + i * (mode === "processing" ? 1.4 : 2.1);
        const wobble =
          Math.sin(t) * (mode === "barge_in" ? 0.14 : 0.08) + Math.cos(t * 1.3) * 0.06;
        const levelBoost = reactive ? level * 0.18 : mode === "speaking" ? 0.08 : 0.03;
        const r = baseR * (0.9 + wobble + levelBoost);
        const ox = Math.cos(t * (mode === "processing" ? 1.8 : 0.7)) * baseR * (mode === "barge_in" ? 0.18 : 0.11);
        const oy = Math.sin(t * (mode === "processing" ? 2.1 : 0.9)) * baseR * (mode === "barge_in" ? 0.16 : 0.09);

        const blob = ctx.createRadialGradient(cx + ox, cy + oy, r * 0.12, cx + ox, cy + oy, r);
        blob.addColorStop(0, palette.core);
        blob.addColorStop(0.38, palette.mid);
        blob.addColorStop(0.72, "rgba(30, 30, 36, 0.35)");
        blob.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = blob;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = palette.rim;
      ctx.lineWidth = mode === "barge_in" ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.98, 0, Math.PI * 2);
      ctx.stroke();

      if (mode === "listening" || mode === "barge_in") {
        const ringR = baseR * (1.08 + level * 0.22);
        ctx.strokeStyle = palette.rim.replace(/[\d.]+\)$/, "0.35)");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 200,
        height: 200,
      }}
      aria-hidden
    >
      <canvas ref={canvasRef} width={400} height={400} style={{ width: 200, height: 200 }} />
    </div>
  );
});
```

- [ ] **Step 2: Replace Orb.tsx to use VoiceOrb**

`src/components/orb/Orb.tsx`:

```typescript
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";

function toVisualMode(name: OrbStateName): VoiceVisualMode {
  switch (name) {
    case "listening": return "listening";
    case "bargeIn": return "barge_in";
    case "processing": return "processing";
    case "responding": return "speaking";
    case "working": return "thinking";
    default: return "idle";
  }
}

interface OrbProps {
  state: OrbState;
  level: number;
  onSummon?: () => void;
  onStop?: () => void;
  onExpand?: () => void;
}

export function Orb({ state, level, onExpand }: OrbProps) {
  const visualMode = toVisualMode(state.name);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "24px 16px",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Gear button */}
      <button
        onClick={onExpand}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 16,
          padding: "4px 8px",
          lineHeight: 1,
        }}
        title="Open settings"
      >
        ⚙
      </button>

      <VoiceOrb visualMode={visualMode} audioLevel={level} />

      {/* Transcript / response text */}
      {state.transcript && (
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            textAlign: "center",
            maxWidth: 340,
            lineHeight: 1.5,
          }}
        >
          {state.transcript}
        </div>
      )}
      {state.responseText && (
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.88)",
            textAlign: "center",
            maxWidth: 340,
            lineHeight: 1.6,
          }}
        >
          {state.responseText}
        </div>
      )}
      {state.error && (
        <div style={{ fontSize: 12, color: "rgba(255,80,80,0.9)", textAlign: "center" }}>
          {state.error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
cd nova-mac && git add src/components/orb/VoiceOrb.tsx src/components/orb/Orb.tsx
git commit -m "feat(mac): canvas VoiceOrb port — 6-state palettes, animated blobs, reactive rings"
```

---

### Task 3: Text composer + IPC stubs for App window

**Files:**
- Create: `src/components/composer/TextComposer.tsx`
- Modify: `src/App.tsx`
- Modify: `shared/types.ts` — add `AppOpen`, `AppClose`, `GetWindowMode`, `PrefsChanged` IPC channels
- Modify: `electron/preload.ts` — add stub methods (no-op until Task 5 wires main)
- Modify: `src/lib/ipc.ts` — extend type

**Interfaces:**
- Produces: `TextComposer` that calls `nova().chatSend(...)` with `inputModality: "text"`; `nova().appOpen()` IPC stub

---

- [ ] **Step 1: Add new IPC channels to shared/types.ts**

Add to `IpcChannel` enum (after existing entries):

```typescript
// Window management
GetWindowMode = "window:get-mode",
AppOpen = "app:open",
AppClose = "app:close",
// Preferences push
PrefsChanged = "prefs:changed",
// Prefs get/set (used by Settings tab — wired in Task 7)
PrefsGet = "prefs:get",
PrefsSet = "prefs:set",
// Connections (wired in Task 10)
ConnectionsStatus = "connections:status",
ConnectionsConnect = "connections:connect",
ConnectionsDisconnect = "connections:disconnect",
ConnectionsCallback = "connections:callback",
YoutubeRefreshTaste = "youtube:refresh-taste",
// Reminders (wired in Task 8)
RemindersGet = "reminders:get",
RemindersDone = "reminders:done",
RemindersDelete = "reminders:delete",
// Memory (wired in Task 9)
MemorySearch = "memory:search",
MemoryPin = "memory:pin",
MemoryArchive = "memory:archive",
MemoryDelete = "memory:delete",
```

Also add supporting types at the bottom of `shared/types.ts`:

```typescript
export type WindowMode = "orb" | "app";

export interface ProactivePrefs {
  proactiveMode: "off" | "reminders_only" | "full";
  dailyBriefEnabled: boolean;
  briefTimeLocal: string;
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export const DEFAULT_PROACTIVE_PREFS: ProactivePrefs = {
  proactiveMode: "off",
  dailyBriefEnabled: false,
  briefTimeLocal: "08:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

export interface AllPrefs {
  voice: VoicePreferences;
  proactive: ProactivePrefs;
}

export type GoogleService = "calendar" | "gmail" | "youtube";

export interface GoogleConnectionStatus {
  calendar: { connected: boolean; email: string | null };
  gmail: { connected: boolean; email: string | null };
  youtube: { connected: boolean; email: string | null };
}

export interface ReminderItem {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  memoryType: string | null;
  salience: number;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Add stub methods to preload.ts**

Add to the `contextBridge.exposeInMainWorld("nova", { ... })` object in `electron/preload.ts`:

```typescript
  getWindowMode: (): Promise<string> => ipcRenderer.invoke(IpcChannel.GetWindowMode),
  appOpen: () => ipcRenderer.send(IpcChannel.AppOpen),
  appClose: () => ipcRenderer.send(IpcChannel.AppClose),
  onPrefsChanged: (cb: (p: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.PrefsChanged, h);
    return () => ipcRenderer.removeListener(IpcChannel.PrefsChanged, h);
  },
  prefsGet: () => ipcRenderer.invoke(IpcChannel.PrefsGet),
  prefsSet: (patch: unknown) => ipcRenderer.invoke(IpcChannel.PrefsSet, patch),
  connectionsStatus: () => ipcRenderer.invoke(IpcChannel.ConnectionsStatus),
  connectionsConnect: (req: unknown) => ipcRenderer.invoke(IpcChannel.ConnectionsConnect, req),
  connectionsDisconnect: (req: unknown) => ipcRenderer.invoke(IpcChannel.ConnectionsDisconnect, req),
  onConnectionsCallback: (cb: () => void): (() => void) => {
    const h = () => cb();
    ipcRenderer.on(IpcChannel.ConnectionsCallback, h);
    return () => ipcRenderer.removeListener(IpcChannel.ConnectionsCallback, h);
  },
  youtubeRefreshTaste: () => ipcRenderer.invoke(IpcChannel.YoutubeRefreshTaste),
  remindersGet: () => ipcRenderer.invoke(IpcChannel.RemindersGet),
  remindersDone: (id: string) => ipcRenderer.invoke(IpcChannel.RemindersDone, id),
  remindersDelete: (id: string) => ipcRenderer.invoke(IpcChannel.RemindersDelete, id),
  memorySearch: (req: unknown) => ipcRenderer.invoke(IpcChannel.MemorySearch, req),
  memoryPin: (req: unknown) => ipcRenderer.invoke(IpcChannel.MemoryPin, req),
  memoryArchive: (req: unknown) => ipcRenderer.invoke(IpcChannel.MemoryArchive, req),
  memoryDelete: (id: string) => ipcRenderer.invoke(IpcChannel.MemoryDelete, id),
```

- [ ] **Step 3: Update src/lib/ipc.ts to expose new methods**

`src/lib/ipc.ts` — extend the `NovaApi` interface (add alongside existing methods):

```typescript
getWindowMode: () => Promise<string>;
appOpen: () => void;
appClose: () => void;
onPrefsChanged: (cb: (p: unknown) => void) => () => void;
prefsGet: () => Promise<unknown>;
prefsSet: (patch: unknown) => Promise<unknown>;
connectionsStatus: () => Promise<unknown>;
connectionsConnect: (req: unknown) => Promise<void>;
connectionsDisconnect: (req: unknown) => Promise<void>;
onConnectionsCallback: (cb: () => void) => () => void;
youtubeRefreshTaste: () => Promise<void>;
remindersGet: () => Promise<unknown>;
remindersDone: (id: string) => Promise<void>;
remindersDelete: (id: string) => Promise<void>;
memorySearch: (req: unknown) => Promise<unknown>;
memoryPin: (req: unknown) => Promise<void>;
memoryArchive: (req: unknown) => Promise<void>;
memoryDelete: (id: string) => Promise<void>;
```

- [ ] **Step 4: Create TextComposer component**

Create `src/components/composer/TextComposer.tsx`:

```typescript
import { useRef, useState } from "react";
import { nova } from "../../lib/ipc";

interface TextComposerProps {
  onSend?: (text: string) => void;
}

export function TextComposer({ onSend }: TextComposerProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `text-${Date.now()}`;
    nova().chatSend({
      requestId: id,
      messages: [{ role: "user", content: trimmed }],
      inputModality: "text",
    });
    onSend?.(trimmed);
    setText("");
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        margin: "0 16px 16px",
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        placeholder="Type a message…"
        style={{
          flex: 1,
          background: "none",
          border: "none",
          outline: "none",
          color: "rgba(255,255,255,0.88)",
          fontSize: 14,
          minWidth: 0,
        }}
      />
      <button
        onClick={send}
        disabled={!text.trim()}
        style={{
          background: text.trim() ? "rgba(10,132,255,0.9)" : "rgba(255,255,255,0.1)",
          border: "none",
          borderRadius: 8,
          color: "white",
          cursor: text.trim() ? "pointer" : "default",
          fontSize: 14,
          padding: "4px 10px",
          transition: "background 0.15s",
        }}
      >
        ↵
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Update App.tsx to include TextComposer and gear/appOpen stub**

`src/App.tsx` — add TextComposer below orb in `VoiceApp`, remove `ChatSheet` import (replaced by text composer):

```typescript
import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { useVoice } from "./hooks/useVoice";
import { Orb } from "./components/orb/Orb";
import { TextComposer } from "./components/composer/TextComposer";

function VoiceApp({ email }: { email: string | null }) {
  const { state, level } = useVoice();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={{ position: "fixed", top: 8, left: 8, fontSize: 10, opacity: 0.3 }}>
        {email}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Orb
          state={state}
          level={level}
          onExpand={() => nova().appOpen()}
        />
      </div>
      <TextComposer />
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    nova().authStatus().then(setAuth).catch((e) => setStatus(`auth check failed: ${e?.message ?? e}`));
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  if (!auth.signedIn) {
    const sendLink = () => {
      setStatus("Sending magic link…");
      nova()
        .authSignIn(email)
        .then(() => setStatus(`Magic link sent to ${email}. Check your email, then return here.`))
        .catch((e) => setStatus(`Sign-in failed: ${e?.message ?? e}`));
    };
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24, boxSizing: "border-box" }}>
        <div className="nova-glass nova-card" style={{ padding: 24, width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Sign in to Nova</div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "white", fontSize: 14, outline: "none" }}
          />
          <button
            onClick={sendLink}
            style={{ padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "rgba(10,132,255,0.95)", color: "white", fontSize: 14, fontWeight: 600 }}
          >
            Send magic link
          </button>
          {status && <div style={{ fontSize: 12, opacity: 0.8 }}>{status}</div>}
        </div>
      </div>
    );
  }

  return <VoiceApp email={auth.email} />;
}
```

- [ ] **Step 6: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors

- [ ] **Step 7: Commit**

```bash
cd nova-mac && git add shared/types.ts electron/preload.ts src/lib/ipc.ts src/components/composer/TextComposer.tsx src/App.tsx
git commit -m "feat(mac): text composer, IPC stubs for app-window, prefs-changed, connections, reminders, memory"
```

---

### Task 4: Design system — Tailwind + CSS tokens + UI primitives

**Files:**
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Modify: `src/styles/global.css`
- Modify: `src/styles/glass.css`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/Select.tsx`
- Modify: `package.json` (devDependencies)

---

- [ ] **Step 1: Install Tailwind and dependencies**

```bash
cd nova-mac && npm install --save-dev tailwindcss autoprefixer postcss clsx tailwind-merge && npm install @tabler/icons-react
```

- [ ] **Step 2: Create tailwind.config.ts**

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{tsx,ts}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3: Create postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Add Tailwind directives to global.css**

Create/update `src/styles/global.css` to prepend Tailwind:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

(Keep existing imports below.)

- [ ] **Step 5: Update glass.css with exact web app tokens**

`src/styles/glass.css`:

```css
:root {
  --nova-bg: #080808;
  --nova-surface: rgb(16 16 16 / 88%);
  --nova-border: rgb(255 255 255 / 8%);
  --nova-border-strong: rgb(255 255 255 / 14%);
  --nova-text: #e8e8ed;
  --nova-text-secondary: #8b9099;
  --nova-accent: #0a84ff;
  --nova-radius-card: 16px;
  --nova-radius-pill: 24px;
  --nova-shadow-dock: 0 12px 40px rgb(0 0 0 / 45%), inset 0 1px 0 rgb(255 255 255 / 6%);
}

.nova-glass {
  background: rgb(16 16 16 / 72%);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgb(255 255 255 / 10%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 12%), 0 0 0 0.5px rgb(0 0 0 / 30%);
}

.nova-card {
  border-radius: var(--nova-radius-card);
}

.nova-orb {
  border-radius: 9999px;
}
```

- [ ] **Step 6: Create cn() utility**

`src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 7: Create Button primitive**

`src/components/ui/Button.tsx`:

```typescript
import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-all",
        "focus:outline-none focus:ring-2 focus:ring-[--nova-accent]/40",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        variant === "primary" && "bg-[--nova-accent] text-white hover:bg-[--nova-accent]/90",
        variant === "secondary" && "bg-white/8 border border-white/10 text-[--nova-text] hover:bg-white/12",
        variant === "ghost" && "text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/6",
        variant === "danger" && "bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/22",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 8: Create Card primitive**

`src/components/ui/Card.tsx`:

```typescript
import { cn } from "../../lib/utils";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "nova-glass nova-card p-4",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 9: Create Select primitive**

`src/components/ui/Select.tsx`:

```typescript
import { cn } from "../../lib/utils";
import type { SelectHTMLAttributes } from "react";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-[--nova-text]",
        "focus:outline-none focus:ring-2 focus:ring-[--nova-accent]/40",
        "appearance-none cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 10: Verify electron-vite picks up postcss**

The renderer vite config in `electron.vite.config.ts` auto-detects `postcss.config.js` — no changes needed.

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no errors

- [ ] **Step 11: Commit**

```bash
cd nova-mac && git add tailwind.config.ts postcss.config.js src/styles/global.css src/styles/glass.css src/lib/utils.ts src/components/ui/Button.tsx src/components/ui/Card.tsx src/components/ui/Select.tsx package.json package-lock.json
git commit -m "feat(mac): design system — Tailwind, CSS tokens, Button/Card/Select primitives, cn() utility"
```

---

### Task 5: Expanded app window + GetWindowMode IPC + main.ts wiring

**Files:**
- Modify: `electron/window.ts` — add `createAppWindow()`
- Modify: `electron/main.ts` — wire `AppOpen`/`AppClose`, `GetWindowMode`, tray update
- Modify: `electron/ipc.ts` — add window handlers
- Modify: `electron/tray.ts` — add "Open Nova" menu item

---

- [ ] **Step 1: Add createAppWindow() to window.ts**

`electron/window.ts`:

```typescript
import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createOrbWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    vibrancy: "under-window",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "mediaKeySystem");
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: "detach" });
    win.once("ready-to-show", () => win.show());
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: true,
    transparent: false,
    vibrancy: "under-window",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#080808",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  win.once("ready-to-show", () => win.show());
  return win;
}
```

- [ ] **Step 2: Update electron/ipc.ts to add window handlers**

Add to `ipc.ts` — a new registration function:

```typescript
export function registerWindowHandlers(
  orbWindow: () => BrowserWindow | null,
  appWindow: () => BrowserWindow | null,
  createApp: () => BrowserWindow,
): void {
  // GetWindowMode: return "orb" or "app" based on which window sent the request
  ipcMain.handle(IpcChannel.GetWindowMode, (e) => {
    const orb = orbWindow();
    if (orb && e.sender.id === orb.webContents.id) return "orb";
    return "app";
  });

  ipcMain.on(IpcChannel.AppOpen, () => {
    let app = appWindow();
    if (!app || app.isDestroyed()) {
      app = createApp();
    }
    const orb = orbWindow();
    orb?.hide();
    if (app.isVisible()) {
      app.focus();
    } else {
      app.show();
    }
  });

  ipcMain.on(IpcChannel.AppClose, () => {
    const app = appWindow();
    app?.hide();
    const orb = orbWindow();
    orb?.show();
  });
}
```

Also update imports at top of `ipc.ts`:
```typescript
import { ipcMain, type BrowserWindow, type WebContents } from "electron";
```

- [ ] **Step 3: Update main.ts to wire app window and new IPC**

`electron/main.ts`:

```typescript
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { join } from "node:path";
import { createOrbWindow, createAppWindow } from "./window";
import { createTray } from "./tray";
import {
  registerIpcHandlers,
  registerChatBridge,
  registerWakeBridge,
  registerWindowHandlers,
} from "./ipc";
import { streamChat, cancelChat } from "./chat";
import { startSignIn, signOut, getAuthState, handleAuthCallback, restoreSession } from "./auth";
import { WakeWordController } from "./wakeword/index";
import { IpcChannel } from "@shared/types";

let orbWin: BrowserWindow | null = null;
let appWin: BrowserWindow | null = null;
let _trayRef: ReturnType<typeof createTray> | null = null;

app.dock?.hide();
app.setAsDefaultProtocolClient("nova");

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url.startsWith("nova://auth-callback")) {
    void handleAuthCallback(url);
  } else if (url.startsWith("nova://connections-callback")) {
    void import("./google/connections").then((m) => m.handleConnectionsCallback(url, appWin));
  }
});

app.whenReady().then(async () => {
  registerIpcHandlers({
    ping: async () => "pong",
    authStatus: getAuthState,
    authSignIn: startSignIn,
    authSignOut: signOut,
    syncConversations: () => import("./sync").then((m) => m.listConversations()),
    syncMemories: () => import("./sync").then((m) => m.listMemories()),
    transcribe: (req, provider) => import("./voice/stt").then((m) => m.transcribe(req, provider)),
    synthesize: (req) => import("./voice/tts").then((m) => m.synthesize(req)),
    getVoicePreferences: () => import("./voice/preferences").then((m) => m.getVoicePreferences()),
  });

  registerChatBridge({
    start: (req, sender) => void streamChat(req, (channel, payload) => sender.send(channel, payload)),
    cancel: cancelChat,
  });

  registerWindowHandlers(
    () => orbWin,
    () => appWin,
    () => {
      appWin = createAppWindow();
      appWin.on("closed", () => { appWin = null; });
      return appWin;
    },
  );

  const modelsDir = app.isPackaged
    ? join(process.resourcesPath, "wakeword-models")
    : join(app.getAppPath(), "electron", "wakeword", "models");
  const wake = new WakeWordController(modelsDir);
  wake.start(() => {
    wake.pauseForTurn();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IpcChannel.WakeDetected);
  });
  registerWakeBridge({
    pushFrame: (buf) => wake.pushFrame(buf),
    setEnabled: (on) => wake.setEnabled(on),
  });
  ipcMain.on(IpcChannel.VoiceTurnEnded, () => wake.resume());

  try {
    const { probeNative } = await import("./native-probe/index.js");
    console.log("[nova] native probe:", probeNative());
  } catch {
    console.warn("[nova] native probe not built (expected in dev)");
  }

  await restoreSession();
  orbWin = createOrbWindow();
  _trayRef = createTray(orbWin, () => {
    // "Open Nova" tray item callback
    let app = appWin;
    if (!app || app.isDestroyed()) {
      app = createAppWindow();
      appWin = app;
    }
    orbWin?.hide();
    app.show();
    app.focus();
  });
  void _trayRef;

  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!orbWin) return;
    orbWin.isVisible() ? orbWin.hide() : orbWin.show();
  });
  orbWin.once("ready-to-show", () => console.log("[nova] orb window ready"));
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {});
```

- [ ] **Step 4: Update tray.ts to accept openApp callback**

`electron/tray.ts` — add the second argument:

```typescript
import { app, Menu, Tray, nativeImage, BrowserWindow } from "electron";
import { join } from "node:path";

export function createTray(win: BrowserWindow, onOpenApp?: () => void): Tray {
  const iconPath = join(import.meta.dirname, "../../resources/tray-icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("Nova");

  const menu = Menu.buildFromTemplate([
    {
      label: "Show Orb",
      click: () => { win.isVisible() ? win.hide() : win.show(); },
    },
    {
      label: "Open Nova",
      click: () => onOpenApp?.(),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on("click", () => { win.isVisible() ? win.hide() : win.show(); });
  return tray;
}
```

- [ ] **Step 5: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
cd nova-mac && git add electron/window.ts electron/ipc.ts electron/main.ts electron/tray.ts
git commit -m "feat(mac): expanded app window — createAppWindow, GetWindowMode IPC, AppOpen/AppClose handlers, tray menu"
```

---

### Task 6: Renderer routing + FloatingDock + AppShell + AppDock

**Files:**
- Modify: `src/main.tsx` — detect window mode, render orb or app shell
- Create: `src/AppShell.tsx`
- Create: `src/components/ui/floating-dock.tsx`
- Create: `src/components/dock/AppDock.tsx`
- Create: `src/pages/PlaceholderPage.tsx`

---

- [ ] **Step 1: Update src/main.tsx to route by window mode**

`src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./styles/glass.css";
import { App } from "./App";
import { AppShell } from "./AppShell";
import { nova } from "./lib/ipc";

async function mount() {
  const root = document.getElementById("root")!;

  let mode = "orb";
  try {
    mode = await nova().getWindowMode();
  } catch {
    // fallback to orb if IPC not yet wired
  }

  createRoot(root).render(
    <StrictMode>
      {mode === "app" ? <AppShell /> : <App />}
    </StrictMode>,
  );
}

void mount();
```

- [ ] **Step 2: Create FloatingDock (Electron-adapted)**

Create `src/components/ui/floating-dock.tsx` — adapted from web app's version with `onClick` instead of `href`:

```typescript
import { cn } from "../../lib/utils";
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { useRef, useState } from "react";

export type DockItem = { title: string; icon: React.ReactNode; onClick: () => void };

export const FloatingDock = ({
  items,
  className,
}: {
  items: DockItem[];
  className?: string;
}) => {
  const mouseX = useMotionValue(Infinity);
  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        "mx-auto flex h-16 items-end gap-4 rounded-[24px] px-4 pb-2.5 pt-2",
        "border border-[rgb(255_255_255/8%)] bg-[rgb(16_16_16/88%)]",
        "shadow-[0_12px_40px_rgb(0_0_0/45%),inset_0_1px_0_rgb(255_255_255/6%)]",
        "backdrop-blur-xl",
        className,
      )}
    >
      {items.map((item) => (
        <IconContainer mouseX={mouseX} key={item.title} {...item} />
      ))}
    </motion.div>
  );
};

function IconContainer({
  mouseX,
  title,
  icon,
  onClick,
}: DockItem & { mouseX: MotionValue }) {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthTransform = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const heightTransform = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const widthTransformIcon = useTransform(distance, [-150, 0, 150], [20, 40, 20]);
  const heightTransformIcon = useTransform(distance, [-150, 0, 150], [20, 40, 20]);

  const width = useSpring(widthTransform, { mass: 0.08, stiffness: 110, damping: 18 });
  const height = useSpring(heightTransform, { mass: 0.08, stiffness: 110, damping: 18 });
  const widthIcon = useSpring(widthTransformIcon, { mass: 0.08, stiffness: 110, damping: 18 });
  const heightIcon = useSpring(heightTransformIcon, { mass: 0.08, stiffness: 110, damping: 18 });

  const [hovered, setHovered] = useState(false);

  return (
    <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
      <motion.div
        ref={ref}
        style={{ width, height }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative flex aspect-square items-center justify-center rounded-full bg-white/10"
      >
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: 2, x: "-50%" }}
              className="absolute -top-8 left-1/2 w-fit rounded-md border border-white/10 bg-[rgb(16_16_16/88%)] px-2 py-0.5 text-xs whitespace-pre text-white/80"
            >
              {title}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div style={{ width: widthIcon, height: heightIcon }} className="flex items-center justify-center text-white/75">
          {icon}
        </motion.div>
      </motion.div>
    </button>
  );
}
```

- [ ] **Step 3: Create AppDock**

Create `src/components/dock/AppDock.tsx`:

```typescript
import {
  IconMicrophone,
  IconBell,
  IconBrain,
  IconPlugConnected,
  IconSettings,
  IconLogout,
} from "@tabler/icons-react";
import { FloatingDock, type DockItem } from "../ui/floating-dock";
import { nova } from "../../lib/ipc";

type Tab = "reminders" | "memory" | "connections" | "settings";

interface AppDockProps {
  onTabChange: (tab: Tab) => void;
}

export function AppDock({ onTabChange }: AppDockProps) {
  const items: DockItem[] = [
    { title: "Orb", icon: <IconMicrophone size={20} />, onClick: () => nova().appClose() },
    { title: "Reminders", icon: <IconBell size={20} />, onClick: () => onTabChange("reminders") },
    { title: "Memory", icon: <IconBrain size={20} />, onClick: () => onTabChange("memory") },
    { title: "Connections", icon: <IconPlugConnected size={20} />, onClick: () => onTabChange("connections") },
    { title: "Settings", icon: <IconSettings size={20} />, onClick: () => onTabChange("settings") },
    { title: "Sign out", icon: <IconLogout size={20} />, onClick: () => void nova().authSignOut() },
  ];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <FloatingDock items={items} />
    </div>
  );
}
```

- [ ] **Step 4: Create placeholder pages**

Create `src/pages/PlaceholderPage.tsx` (used until Tasks 7–10 implement real pages):

```typescript
interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="flex items-center justify-center h-full text-[--nova-text-secondary] text-sm">
      {title} — coming soon
    </div>
  );
}
```

- [ ] **Step 5: Create AppShell**

Create `src/AppShell.tsx`:

```typescript
import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { AppDock } from "./components/dock/AppDock";
import { PlaceholderPage } from "./pages/PlaceholderPage";

type Tab = "reminders" | "memory" | "connections" | "settings";

function AppContent() {
  const [tab, setTab] = useState<Tab>("settings");

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--nova-bg)", color: "var(--nova-text)" }}
    >
      {/* Traffic lights inset area */}
      <div style={{ height: 28, WebkitAppRegion: "drag" } as React.CSSProperties} />

      {/* Main content */}
      <div className="flex-1 overflow-auto px-6 pb-28">
        {tab === "reminders" && <PlaceholderPage title="Reminders" />}
        {tab === "memory" && <PlaceholderPage title="Memory" />}
        {tab === "connections" && <PlaceholderPage title="Connections" />}
        {tab === "settings" && <PlaceholderPage title="Settings" />}
      </div>

      <AppDock onTabChange={setTab} />
    </div>
  );
}

export function AppShell() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });

  useEffect(() => {
    nova().authStatus().then(setAuth).catch(() => {});
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  if (!auth.signedIn) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-[--nova-text-secondary]">
        Not signed in
      </div>
    );
  }

  return <AppContent />;
}
```

- [ ] **Step 6: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors

- [ ] **Step 7: Commit**

```bash
cd nova-mac && git add src/main.tsx src/AppShell.tsx src/components/ui/floating-dock.tsx src/components/dock/AppDock.tsx src/pages/PlaceholderPage.tsx
git commit -m "feat(mac): app shell — FloatingDock port, AppDock, AppShell with tab routing, renderer mode detection"
```

---

### Task 7: Prefs IPC + SettingsPage

**Files:**
- Create: `electron/voice/save-preferences.ts`
- Modify: `electron/ipc.ts` — register `PrefsGet`/`PrefsSet`
- Modify: `electron/main.ts` — wire prefs handlers
- Create: `src/pages/SettingsPage.tsx`
- Modify: `src/AppShell.tsx` — render SettingsPage

---

- [ ] **Step 1: Create save-preferences.ts**

Create `electron/voice/save-preferences.ts`:

```typescript
import { getSupabase } from "../supabase";
import { getUserId } from "../auth";
import type { VoicePreferences } from "@shared/types";

export async function saveVoicePreferences(patch: Partial<VoicePreferences>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data: existing } = await supabase
    .from("user_preferences")
    .select("voice")
    .eq("user_id", userId)
    .single();

  const merged = { ...(existing?.voice ?? {}), ...patch };

  await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, voice: merged }, { onConflict: "user_id" });
}

export async function saveProactivePreferences(patch: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
}

export async function getAllPreferences(): Promise<{ voice: VoicePreferences; proactive: Record<string, unknown> }> {
  const { getVoicePreferences } = await import("./preferences");
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data } = await supabase
    .from("user_preferences")
    .select("proactive_mode, daily_brief_enabled, brief_time_local, timezone, quiet_hours_start, quiet_hours_end")
    .eq("user_id", userId)
    .single();

  return {
    voice: await getVoicePreferences(),
    proactive: data ?? {},
  };
}
```

- [ ] **Step 2: Register prefs IPC handlers in main.ts**

Add to the `app.whenReady()` block in `electron/main.ts` after `registerWindowHandlers(...)`:

```typescript
  // Prefs
  ipcMain.handle(IpcChannel.PrefsGet, () =>
    import("./voice/save-preferences").then((m) => m.getAllPreferences()),
  );
  ipcMain.handle(IpcChannel.PrefsSet, async (_e, patch: { voice?: unknown; proactive?: unknown }) => {
    const mod = await import("./voice/save-preferences");
    if (patch.voice) await mod.saveVoicePreferences(patch.voice as never);
    if (patch.proactive) await mod.saveProactivePreferences(patch.proactive as Record<string, unknown>);
    const updated = await mod.getAllPreferences();
    // Broadcast to all windows so orb voice prefs stay in sync
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IpcChannel.PrefsChanged, updated.voice);
    }
    return updated;
  });
```

- [ ] **Step 3: Create SettingsPage**

Create `src/pages/SettingsPage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { nova } from "../lib/ipc";
import type { AllPrefs, VoicePreferences, ProactivePrefs } from "@shared/types";
import { DEFAULT_VOICE_PREFERENCES, DEFAULT_PROACTIVE_PREFS } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
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
            <option value="spoken">Say "Got it"</option>
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
```

- [ ] **Step 4: Wire SettingsPage into AppShell**

`src/AppShell.tsx` — replace `import { PlaceholderPage }` with real page:

```typescript
import { SettingsPage } from "./pages/SettingsPage";
// ... in AppContent render:
{tab === "settings" && <SettingsPage />}
```

- [ ] **Step 5: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
cd nova-mac && git add electron/voice/save-preferences.ts electron/main.ts src/pages/SettingsPage.tsx src/AppShell.tsx
git commit -m "feat(mac): settings tab — PrefsGet/PrefsSet IPC, SettingsPage with voice + proactive sections"
```

---

### Task 8: Reminders IPC + RemindersPage

**Files:**
- Create: `electron/memory/reminders.ts`
- Modify: `electron/main.ts` — wire reminders IPC
- Create: `src/pages/RemindersPage.tsx`
- Modify: `src/AppShell.tsx` — render RemindersPage

---

- [ ] **Step 1: Create electron/memory/reminders.ts**

```typescript
import { getSupabase } from "../supabase";
import { getUserId } from "../auth";
import type { ReminderItem } from "@shared/types";

export async function listReminders(status = "pending"): Promise<ReminderItem[]> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("reminders")
    .select("id, title, due_at, status")
    .eq("user_id", userId)
    .eq("status", status)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.due_at,
    status: r.status,
  }));
}

export async function completeReminder(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("reminders")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteReminder(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("reminders").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Register reminders IPC in main.ts**

Add to the `app.whenReady()` block after prefs handlers:

```typescript
  // Reminders
  ipcMain.handle(IpcChannel.RemindersGet, () =>
    import("./memory/reminders").then((m) => m.listReminders()),
  );
  ipcMain.handle(IpcChannel.RemindersDone, (_e, id: string) =>
    import("./memory/reminders").then((m) => m.completeReminder(id)),
  );
  ipcMain.handle(IpcChannel.RemindersDelete, (_e, id: string) =>
    import("./memory/reminders").then((m) => m.deleteReminder(id)),
  );
```

- [ ] **Step 3: Create RemindersPage**

Create `src/pages/RemindersPage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { nova } from "../lib/ipc";
import type { ReminderItem } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt) < new Date();
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  const d = new Date(dueAt);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function RemindersPage() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await nova().remindersGet();
      setReminders(data as ReminderItem[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function markDone(id: string) {
    await nova().remindersDone(id);
    setReminders((rs) => rs.filter((r) => r.id !== id));
  }

  async function remove(id: string) {
    await nova().remindersDelete(id);
    setReminders((rs) => rs.filter((r) => r.id !== id));
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-[--nova-text-secondary]">Loading…</div>;
  }

  if (reminders.length === 0) {
    return <div className="flex items-center justify-center h-full text-sm text-[--nova-text-secondary]">No pending reminders</div>;
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-3">
      <h1 className="text-lg font-semibold text-[--nova-text]">Reminders</h1>
      {reminders.map((r) => (
        <Card key={r.id} className={`flex items-start justify-between gap-3 ${isOverdue(r.dueAt) ? "border-amber-500/30" : ""}`}>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[--nova-text] font-medium">{r.title}</div>
            <div className={`text-xs mt-0.5 ${isOverdue(r.dueAt) ? "text-amber-400" : "text-[--nova-text-secondary]"}`}>
              {formatDue(r.dueAt)}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button size="sm" variant="primary" onClick={() => void markDone(r.id)}>Done</Button>
            <Button size="sm" variant="danger" onClick={() => void remove(r.id)}>Delete</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire RemindersPage into AppShell**

`src/AppShell.tsx`:
```typescript
import { RemindersPage } from "./pages/RemindersPage";
// ...
{tab === "reminders" && <RemindersPage />}
```

- [ ] **Step 5: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
cd nova-mac && git add electron/memory/reminders.ts electron/main.ts src/pages/RemindersPage.tsx src/AppShell.tsx
git commit -m "feat(mac): reminders tab — CRUD IPC, RemindersPage with overdue highlighting"
```

---

### Task 9: Memory IPC + MemoryPage

**Files:**
- Create: `electron/memory/search.ts`
- Modify: `electron/main.ts` — wire memory IPC
- Create: `src/pages/MemoryPage.tsx`
- Modify: `src/AppShell.tsx` — render MemoryPage

---

- [ ] **Step 1: Create electron/memory/search.ts**

```typescript
import { getSupabase } from "../supabase";
import { getUserId } from "../auth";
import type { MemoryItem } from "@shared/types";

export async function searchMemories(query: string): Promise<MemoryItem[]> {
  const supabase = getSupabase();
  const userId = await getUserId();

  let q = supabase
    .from("memories")
    .select("id, content, memory_type, salience, is_pinned, is_archived, created_at")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("salience", { ascending: false })
    .limit(50);

  if (query) {
    q = q.ilike("content", `%${query}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    content: m.content,
    memoryType: m.memory_type,
    salience: m.salience,
    isPinned: m.is_pinned ?? false,
    isArchived: m.is_archived ?? false,
    createdAt: m.created_at,
  }));
}

export async function pinMemory(id: string, pinned: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("memories").update({ is_pinned: pinned }).eq("id", id);
  if (error) throw error;
}

export async function archiveMemory(id: string, archived: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("memories").update({ is_archived: archived }).eq("id", id);
  if (error) throw error;
}

export async function deleteMemory(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("memories").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Register memory IPC in main.ts**

```typescript
  // Memory
  ipcMain.handle(IpcChannel.MemorySearch, (_e, req: { query: string }) =>
    import("./memory/search").then((m) => m.searchMemories(req.query)),
  );
  ipcMain.handle(IpcChannel.MemoryPin, (_e, req: { id: string; pinned: boolean }) =>
    import("./memory/search").then((m) => m.pinMemory(req.id, req.pinned)),
  );
  ipcMain.handle(IpcChannel.MemoryArchive, (_e, req: { id: string; archived: boolean }) =>
    import("./memory/search").then((m) => m.archiveMemory(req.id, req.archived)),
  );
  ipcMain.handle(IpcChannel.MemoryDelete, (_e, id: string) =>
    import("./memory/search").then((m) => m.deleteMemory(id)),
  );
```

- [ ] **Step 3: Create MemoryPage**

Create `src/pages/MemoryPage.tsx`:

```typescript
import { useEffect, useRef, useState } from "react";
import { nova } from "../lib/ipc";
import type { MemoryItem } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

const TYPE_COLORS: Record<string, string> = {
  fact: "bg-blue-500/20 text-blue-300",
  preference: "bg-purple-500/20 text-purple-300",
  routine: "bg-green-500/20 text-green-300",
  episodic: "bg-amber-500/20 text-amber-300",
  goal: "bg-rose-500/20 text-rose-300",
  relationship: "bg-pink-500/20 text-pink-300",
  skill: "bg-cyan-500/20 text-cyan-300",
};

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(q: string) {
    setLoading(true);
    try {
      const data = await nova().memorySearch({ query: q });
      setMemories(data as MemoryItem[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(""); }, []);

  function onQueryChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(q), 300);
  }

  async function pin(id: string, pinned: boolean) {
    await nova().memoryPin({ id, pinned });
    setMemories((ms) => ms.map((m) => m.id === id ? { ...m, isPinned: pinned } : m));
  }

  async function remove(id: string) {
    await nova().memoryDelete(id);
    setMemories((ms) => ms.filter((m) => m.id !== id));
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-4">
      <h1 className="text-lg font-semibold text-[--nova-text]">Memory</h1>

      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search memories…"
        className="w-full rounded-xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm text-[--nova-text] placeholder:text-[--nova-text-secondary] outline-none focus:ring-2 focus:ring-[--nova-accent]/40"
      />

      {loading ? (
        <div className="text-sm text-center text-[--nova-text-secondary]">Loading…</div>
      ) : memories.length === 0 ? (
        <div className="text-sm text-center text-[--nova-text-secondary]">No memories found</div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <Card key={m.id} className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {m.memoryType && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${TYPE_COLORS[m.memoryType] ?? "bg-white/10 text-white/60"}`}>
                      {m.memoryType}
                    </span>
                  )}
                  {m.isPinned && <span className="text-xs text-amber-400">📌</span>}
                </div>
                <p className="text-sm text-[--nova-text] leading-relaxed">{m.content}</p>
                <p className="text-xs text-[--nova-text-secondary] mt-1">
                  Salience {(m.salience * 100).toFixed(0)}%
                </p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={() => void pin(m.id, !m.isPinned)}>
                  {m.isPinned ? "Unpin" : "Pin"}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(m.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire MemoryPage into AppShell**

```typescript
import { MemoryPage } from "./pages/MemoryPage";
// ...
{tab === "memory" && <MemoryPage />}
```

- [ ] **Step 5: Run build + commit**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
git add electron/memory/search.ts electron/main.ts src/pages/MemoryPage.tsx src/AppShell.tsx
git commit -m "feat(mac): memory tab — search/pin/archive/delete IPC, MemoryPage with type badges"
```

---

### Task 10: Connections IPC + Google OAuth deep-link + ConnectionsPage

**Files:**
- Modify: `electron/google/config.ts` — redirect URI → `nova://connections-callback`
- Create: `electron/google/connections.ts` — PKCE flow + callback handler
- Create: `electron/google/db-tokens.ts` — token save/load/delete (if not already present)
- Modify: `electron/main.ts` — wire connections IPC + open-url routing
- Create: `src/pages/ConnectionsPage.tsx`
- Modify: `src/AppShell.tsx` — render ConnectionsPage

---

- [ ] **Step 1: Update config.ts redirect URI**

`electron/google/config.ts` — replace `getRedirectUriForService`:

```typescript
export function getRedirectUriForService(_service: GoogleService): string {
  return "nova://connections-callback";
}
```

Remove the old switch/case and env-var overrides entirely.

- [ ] **Step 2: Create connections.ts with PKCE flow**

Create `electron/google/connections.ts`:

```typescript
import { shell, type BrowserWindow } from "electron";
import crypto from "node:crypto";
import { getSupabase } from "../supabase";
import { getUserId } from "../auth";
import { buildServiceAuthUrl, exchangeCodeForTokens } from "./oauth";
import type { GoogleService } from "./scopes";
import type { GoogleConnectionStatus } from "@shared/types";
import { IpcChannel } from "@shared/types";

// code_verifier keyed by state param for PKCE
const pendingStates = new Map<string, { service: GoogleService }>();

export async function startOAuthFlow(service: GoogleService): Promise<void> {
  const state = crypto.randomUUID();
  pendingStates.set(state, { service });
  // PKCE not needed since googleapis handles it internally for desktop flows;
  // state param provides CSRF protection
  const url = buildServiceAuthUrl(service, state);
  await shell.openExternal(url);
}

export async function handleConnectionsCallback(
  url: string,
  appWin: BrowserWindow | null,
): Promise<void> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");

  if (!code || !state) return;

  const pending = pendingStates.get(state);
  if (!pending) return;
  pendingStates.delete(state);

  const tokens = await exchangeCodeForTokens(code, pending.service);
  const supabase = getSupabase();
  const userId = await getUserId();

  const { error } = await supabase.from("google_oauth_tokens").upsert(
    {
      user_id: userId,
      service: pending.service,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    },
    { onConflict: "user_id,service" },
  );
  if (error) throw error;

  // Notify renderer to refresh status
  appWin?.webContents.send(IpcChannel.ConnectionsCallback);
}

export async function getConnectionsStatus(): Promise<GoogleConnectionStatus> {
  const supabase = getSupabase();
  const userId = await getUserId();

  const { data } = await supabase
    .from("google_oauth_tokens")
    .select("service, access_token")
    .eq("user_id", userId);

  const connected = new Set((data ?? []).map((r) => r.service));
  return {
    calendar: { connected: connected.has("calendar"), email: null },
    gmail: { connected: connected.has("gmail"), email: null },
    youtube: { connected: connected.has("youtube"), email: null },
  };
}

export async function disconnectService(service: GoogleService): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  await supabase
    .from("google_oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("service", service);
}
```

- [ ] **Step 3: Register connections IPC in main.ts**

Add `let appWinRef: (() => BrowserWindow | null) = () => appWin;` and then in `whenReady`:

```typescript
  // Connections
  ipcMain.handle(IpcChannel.ConnectionsStatus, () =>
    import("./google/connections").then((m) => m.getConnectionsStatus()),
  );
  ipcMain.handle(IpcChannel.ConnectionsConnect, (_e, req: { service: string }) =>
    import("./google/connections").then((m) =>
      m.startOAuthFlow(req.service as import("./google/scopes").GoogleService),
    ),
  );
  ipcMain.handle(IpcChannel.ConnectionsDisconnect, (_e, req: { service: string }) =>
    import("./google/connections").then((m) =>
      m.disconnectService(req.service as import("./google/scopes").GoogleService),
    ),
  );
```

The `open-url` handler in `main.ts` already routes `nova://connections-callback` to `handleConnectionsCallback(url, appWin)` from Task 5.

- [ ] **Step 4: Create ConnectionsPage**

Create `src/pages/ConnectionsPage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { nova } from "../lib/ipc";
import type { GoogleConnectionStatus, GoogleService } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

const SERVICES: { key: GoogleService; label: string; description: string }[] = [
  { key: "calendar", label: "Google Calendar", description: "Access your schedule and events" },
  { key: "gmail", label: "Gmail", description: "Read and summarize your emails" },
  { key: "youtube", label: "YouTube", description: "Personalize recommendations based on taste" },
];

export function ConnectionsPage() {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<GoogleService | null>(null);

  async function load() {
    setLoading(true);
    try {
      const s = await nova().connectionsStatus();
      setStatus(s as GoogleConnectionStatus);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Refresh when OAuth callback fires
    const unsub = nova().onConnectionsCallback(() => void load());
    return unsub;
  }, []);

  async function connect(service: GoogleService) {
    setPending(service);
    try {
      await nova().connectionsConnect({ service });
    } finally {
      setPending(null);
    }
  }

  async function disconnect(service: GoogleService) {
    setPending(service);
    try {
      await nova().connectionsDisconnect({ service });
      await load();
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-[--nova-text-secondary]">Loading…</div>;
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-4">
      <h1 className="text-lg font-semibold text-[--nova-text]">Connections</h1>

      <p className="text-sm text-[--nova-text-secondary]">
        Connect your Google services so Nova can access your calendar, email, and YouTube taste profile.
      </p>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-300">
        <strong>One-time setup required:</strong> Add <code>nova://connections-callback</code> as an
        authorized redirect URI in your Google OAuth app at{" "}
        <span className="underline cursor-pointer" onClick={() => void nova().connectionsConnect({ service: "" })}>
          console.cloud.google.com
        </span>
        .
      </div>

      <div className="space-y-3">
        {SERVICES.map((svc) => {
          const svcStatus = status?.[svc.key];
          const isConnected = svcStatus?.connected ?? false;
          const isPending = pending === svc.key;

          return (
            <Card key={svc.key} className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-[--nova-text]">{svc.label}</div>
                <div className="text-xs text-[--nova-text-secondary] mt-0.5">{svc.description}</div>
                {isConnected && (
                  <div className="text-xs text-green-400 mt-1">✓ Connected</div>
                )}
              </div>
              {isConnected ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isPending}
                  onClick={() => void disconnect(svc.key)}
                >
                  {isPending ? "…" : "Disconnect"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isPending}
                  onClick={() => void connect(svc.key)}
                >
                  {isPending ? "Opening…" : "Connect"}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire ConnectionsPage into AppShell**

`src/AppShell.tsx`:
```typescript
import { ConnectionsPage } from "./pages/ConnectionsPage";
// ...
{tab === "connections" && <ConnectionsPage />}
```

Also update final AppShell render — remove all PlaceholderPage usage:

```typescript
import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { AppDock } from "./components/dock/AppDock";
import { SettingsPage } from "./pages/SettingsPage";
import { RemindersPage } from "./pages/RemindersPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";

type Tab = "reminders" | "memory" | "connections" | "settings";

function AppContent() {
  const [tab, setTab] = useState<Tab>("settings");

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--nova-bg)", color: "var(--nova-text)" }}
    >
      <div style={{ height: 28, WebkitAppRegion: "drag" } as React.CSSProperties} />
      <div className="flex-1 overflow-auto px-6 pb-28">
        {tab === "reminders" && <RemindersPage />}
        {tab === "memory" && <MemoryPage />}
        {tab === "connections" && <ConnectionsPage />}
        {tab === "settings" && <SettingsPage />}
      </div>
      <AppDock onTabChange={setTab} />
    </div>
  );
}

export function AppShell() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });

  useEffect(() => {
    nova().authStatus().then(setAuth).catch(() => {});
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  if (!auth.signedIn) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-[--nova-text-secondary]">
        Not signed in
      </div>
    );
  }

  return <AppContent />;
}
```

- [ ] **Step 6: Run build**

```bash
cd nova-mac && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors

- [ ] **Step 7: Run tests**

```bash
cd nova-mac && npm test 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 8: Final commit**

```bash
cd nova-mac && git add electron/google/config.ts electron/google/connections.ts electron/main.ts src/pages/ConnectionsPage.tsx src/AppShell.tsx
git commit -m "feat(mac): connections tab — Google OAuth PKCE deep-link flow, ConnectionsPage, disconnect support"
```

---

## Post-implementation notes

**Google Cloud Console setup (manual, one-time):**
Before Connections tab works, add `nova://connections-callback` as an authorized redirect URI in the OAuth 2.0 client at [console.cloud.google.com](https://console.cloud.google.com). The client type must be "Desktop app" or have custom URI schemes allowed.

**Dev testing the app window:**
1. `npm run dev` starts electron-vite with HMR
2. Click ⚙ in the orb window to open the app window, OR use Tray → "Open Nova"
3. The app window loads the same `index.html` but `nova().getWindowMode()` returns `"app"` → renders `<AppShell />`

**Barge-in verification:**
1. Say the wake phrase → orb goes to listening state
2. Ask a long question → orb starts responding (speaking state, green orb)
3. Speak over the reply → orb should interrupt (amber/barge_in state), then go straight to listening
4. If not working, check Console for `AudioContext state` — should be `running` during barge-in listener
