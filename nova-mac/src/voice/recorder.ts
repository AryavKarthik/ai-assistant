import type { SttProvider } from "@shared/types";
import { MicAnalyser, openMicStream } from "./mic-analyser";
import { sanitizeTranscript } from "./transcript-filter";
import {
  MAX_RECORDING_MS,
  MIN_AUDIO_BLOB_BYTES,
  SpeechGate,
  type SpeechGateOptions,
  STUCK_OPEN_MS,
} from "./vad";

const RECORDER_TIMESLICE_MS = 100;

export interface VoiceRecorderLevelHandler {
  onLevel: (level: number) => void;
}

export interface VoiceRecorderSilenceHandler {
  silenceMs: number;
  onSilence: () => void;
}

export interface VoiceRecorderWatchdogHandler {
  onMaxDuration?: () => void;
  onStuckOpen?: () => void;
}

export interface VoiceRecorderStartOptions {
  level?: VoiceRecorderLevelHandler;
  silence?: VoiceRecorderSilenceHandler;
  watchdog?: VoiceRecorderWatchdogHandler;
  sttProvider?: SttProvider;
  openAiSttModel?: string;
  googleSttQuality?: string;
  speechGateOptions?: SpeechGateOptions;
  existingStream?: MediaStream;
  /** Called once when speech is first confirmed by the gate. */
  onSpeechConfirmed?: () => void;
  /** Allow STT even when the gate never confirmed speech (barge-in probe). */
  allowUnconfirmedSpeech?: boolean;
  /** Called when ambient noise floor is calibrated (for warm-start on next turn). */
  onNoiseFloor?: (floor: number) => void;
}

/**
 * Single mic stream: MediaRecorder + optional level meter + optional silence detection.
 * Transcribes via POST /api/voice/transcribe.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private analyser = new MicAnalyser();
  private levelHandler: VoiceRecorderLevelHandler | null = null;
  private silenceHandler: VoiceRecorderSilenceHandler | null = null;
  private watchdogHandler: VoiceRecorderWatchdogHandler | null = null;
  private onNoiseFloor: ((floor: number) => void) | null = null;
  private sttProvider: SttProvider = "openai";
  private openAiSttModel = "gpt-4o-transcribe";
  private googleSttQuality = "medium";
  private onSpeechConfirmed: (() => void) | null = null;
  private allowUnconfirmedSpeech = false;
  private speechConfirmedFired = false;
  private speechGate: SpeechGate | null = null;
  private disposed = false;
  private recordingStartedAt = 0;
  private stuckOpenSince = 0;
  private captureFinalized = false;
  private captureStopPromise: Promise<void> | null = null;
  private noiseFloorReported = false;

  isActive(): boolean {
    return (
      this.mediaRecorder?.state === "recording" ||
      (this.captureFinalized && this.captureStopPromise !== null)
    );
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  hadConfirmedSpeech(): boolean {
    return this.speechGate?.confirmed ?? true;
  }

  async start(options?: VoiceRecorderStartOptions): Promise<void> {
    const keepStream = options?.existingStream ?? null;
    if (!keepStream) {
      this.dispose();
    } else {
      this.disposed = false;
      this.chunks = [];
      this.captureFinalized = false;
      this.captureStopPromise = null;
      this.noiseFloorReported = false;
      this.analyser.stop();
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        try {
          this.mediaRecorder.stop();
        } catch {
          // ignore
        }
      }
      this.mediaRecorder = null;
    }

    this.disposed = false;
    this.chunks = [];
    this.captureFinalized = false;
    this.captureStopPromise = null;
    this.noiseFloorReported = false;
    this.levelHandler = options?.level ?? null;
    this.silenceHandler = options?.silence ?? null;
    this.watchdogHandler = options?.watchdog ?? null;
    this.onNoiseFloor = options?.onNoiseFloor ?? null;
    this.sttProvider = options?.sttProvider ?? "openai";
    this.openAiSttModel = options?.openAiSttModel ?? "gpt-4o-transcribe";
    this.googleSttQuality = options?.googleSttQuality ?? "medium";
    this.onSpeechConfirmed = options?.onSpeechConfirmed ?? null;
    this.allowUnconfirmedSpeech = options?.allowUnconfirmedSpeech ?? false;
    this.speechConfirmedFired = false;
    // confirmedDecayMs must exceed silenceMs or the gate clears confirmed()
    // on the same analyser frame that the silence check needs confirmed=true,
    // making silence never fire. Keep the gate confirmed for silenceMs + 2000ms.
    const gateOpts: SpeechGateOptions = { ...options?.speechGateOptions };
    if (options?.silence) {
      const minDecay = options.silence.silenceMs + 2000;
      gateOpts.confirmedDecayMs = Math.max(
        gateOpts.confirmedDecayMs ?? 2000,
        minDecay,
      );
    }
    this.speechGate = options?.silence ? new SpeechGate(gateOpts) : null;
    this.recordingStartedAt = Date.now();
    this.stuckOpenSince = 0;

    this.stream = keepStream ?? (await openMicStream());

    if (this.levelHandler || this.silenceHandler) {
      this.analyser.start(this.stream, (speechLevel) => {
        if (this.disposed) return;
        this.levelHandler?.onLevel(speechLevel);

        const gate = this.speechGate;
        if (
          gate &&
          this.silenceHandler &&
          this.mediaRecorder?.state === "recording"
        ) {
          gate.push(speechLevel);

          if (
            gate.confirmed &&
            !this.speechConfirmedFired &&
            this.onSpeechConfirmed
          ) {
            this.speechConfirmedFired = true;
            this.onSpeechConfirmed();
          }

          if (
            !this.noiseFloorReported &&
            gate.isCalibrated() &&
            gate.getNoiseFloor() > 0
          ) {
            this.noiseFloorReported = true;
            this.onNoiseFloor?.(gate.getNoiseFloor());
          }

          const now = Date.now();

          if (gate.confirmed) {
            if (this.stuckOpenSince === 0) {
              this.stuckOpenSince = now;
            } else if (
              now - this.stuckOpenSince >= STUCK_OPEN_MS &&
              gate.msSinceLastSound(now) < 500
            ) {
              gate.clearConfirmed();
              this.stuckOpenSince = 0;
              const handler = this.watchdogHandler;
              this.silenceHandler = null;
              void this.finalizeCapture();
              handler?.onStuckOpen?.();
              return;
            }
          } else {
            this.stuckOpenSince = 0;
          }

          if (now - this.recordingStartedAt >= MAX_RECORDING_MS) {
            const handler = this.watchdogHandler;
            const silence = this.silenceHandler;
            this.silenceHandler = null;
            void this.finalizeCapture().then(() => {
              if (silence) {
                silence.onSilence();
              } else {
                handler?.onMaxDuration?.();
              }
            });
            return;
          }

          if (
            this.silenceHandler &&
            gate.confirmed &&
            gate.msSinceLastSound(now) >= this.silenceHandler.silenceMs
          ) {
            const handler = this.silenceHandler;
            this.silenceHandler = null;
            void this.finalizeCapture().then(() => handler.onSilence());
          }
        }
      });
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    }
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
  }

  /** Stop capture; optionally keep the mic stream alive for barge-in reuse. */
  dispose(options?: { keepStream?: boolean }): void {
    this.disposed = true;
    this.analyser.stop();

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;
    this.chunks = [];
    this.captureFinalized = false;
    this.captureStopPromise = null;

    if (!options?.keepStream) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.levelHandler = null;
    this.silenceHandler = null;
    this.watchdogHandler = null;
    this.onNoiseFloor = null;
    this.speechGate = null;
  }

  releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  /** Flush and stop MediaRecorder as soon as end-of-turn is detected. */
  private finalizeCapture(): Promise<void> {
    if (this.captureFinalized) {
      return this.captureStopPromise ?? Promise.resolve();
    }
    this.captureFinalized = true;

    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      this.captureStopPromise = Promise.resolve();
      return this.captureStopPromise;
    }

    this.captureStopPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        if (recorder.state === "recording") {
          recorder.requestData();
          recorder.stop();
        } else {
          resolve();
        }
      } catch {
        resolve();
      }
    });

    return this.captureStopPromise;
  }

  async stopAndTranscribe(signal?: AbortSignal): Promise<string> {
    const mimeType = this.mediaRecorder?.mimeType ?? "audio/webm";
    const hadConfirmedSpeech = this.speechGate?.confirmed ?? true;

    this.analyser.stop();
    this.levelHandler = null;
    this.silenceHandler = null;
    this.watchdogHandler = null;
    this.onNoiseFloor = null;
    this.speechGate = null;

    await this.finalizeCapture();

    const chunks = [...this.chunks];
    this.mediaRecorder = null;
    this.chunks = [];
    this.captureFinalized = false;
    this.captureStopPromise = null;

    if (signal?.aborted) return "";

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) return "";
    if (!hadConfirmedSpeech && !this.allowUnconfirmedSpeech) return "";
    if (blob.size < MIN_AUDIO_BLOB_BYTES) return "";

    try {
      const form = new FormData();
      form.append(
        "audio",
        blob,
        mimeType.includes("webm") ? "audio.webm" : "audio.mp4",
      );
      form.append("provider", this.sttProvider);
      form.append("openAiSttModel", this.openAiSttModel);
      form.append("googleSttQuality", this.googleSttQuality);

      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: form,
        signal,
      });

      if (res.status === 401) {
        window.location.href = "/login";
        throw new Error("Unauthorized");
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Transcription failed";
        throw new Error(`${message} (/api/voice/transcribe, ${res.status})`);
      }

      const text =
        data && typeof data === "object" && "text" in data
          ? String((data as { text: unknown }).text)
          : "";

      return sanitizeTranscript(text);
    } catch (err) {
      if (signal?.aborted) return "";
      console.error("[voice] transcribe failed:", err);
      throw err;
    }
  }
}
