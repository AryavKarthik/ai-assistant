/** Voice-activity helpers — speech-band level + noise-calibrated gate. */

/** Human speech band (~300–3400 Hz) for a 256-point FFT. */
export function measureSpeechBandLevel(data: Uint8Array): number {
  const start = 2;
  const end = Math.min(18, data.length);
  if (end <= start) return 0;

  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += data[i]!;
  }
  return sum / (end - start) / 255;
}

export interface SpeechGateOptions {
  minThreshold?: number;
  noiseMargin?: number;
  speechHoldMs?: number;
  calibrateMs?: number;
  /** Ms below release threshold before clearing confirmed state. */
  confirmedDecayMs?: number;
  /** Skip cold calibration when the mic was recently calibrated in this session. */
  initialNoiseFloor?: number;
}

/**
 * Calibrates ambient noise, then requires sustained speech-band energy
 * before confirming. Reduces false triggers from HVAC, fans, and room hiss.
 */
export class SpeechGate {
  private readonly minThreshold: number;
  private readonly noiseMargin: number;
  private readonly speechHoldMs: number;
  private readonly calibrateMs: number;
  private readonly confirmedDecayMs: number;

  private calibrating = true;
  private calibrationStartedAt = 0;
  private noiseSamples: number[] = [];
  private noiseFloor = 0;

  private hearing = false;
  private speechStartedAt = 0;
  private _confirmed = false;
  private lastSoundAt = 0;
  private belowReleaseSince = 0;

  constructor(options?: SpeechGateOptions) {
    this.minThreshold = options?.minThreshold ?? 0.12;
    this.noiseMargin = options?.noiseMargin ?? 0.055;
    this.speechHoldMs = options?.speechHoldMs ?? 450;
    this.confirmedDecayMs = options?.confirmedDecayMs ?? 2000;

    const warmFloor = options?.initialNoiseFloor;
    if (warmFloor != null && warmFloor > 0) {
      this.noiseFloor = warmFloor;
      this.calibrateMs = Math.min(options?.calibrateMs ?? 450, 150);
    } else {
      this.calibrateMs = options?.calibrateMs ?? 450;
    }

    this.calibrationStartedAt = Date.now();
  }

  get confirmed(): boolean {
    return this._confirmed;
  }

  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  isCalibrated(): boolean {
    return !this.calibrating;
  }

  get activeThreshold(): number {
    return Math.max(this.minThreshold, this.noiseFloor + this.noiseMargin);
  }

  private releaseThreshold(): number {
    return this.activeThreshold * 0.72;
  }

  reset(): void {
    this.calibrating = true;
    this.calibrationStartedAt = Date.now();
    this.noiseSamples = [];
    this.noiseFloor = 0;
    this.hearing = false;
    this.speechStartedAt = 0;
    this._confirmed = false;
    this.lastSoundAt = 0;
    this.belowReleaseSince = 0;
  }

  /** Clear confirmed state (e.g. stuck-open recovery). */
  clearConfirmed(): void {
    this._confirmed = false;
    this.hearing = false;
    this.speechStartedAt = 0;
    this.lastSoundAt = 0;
    this.belowReleaseSince = 0;
  }

  push(level: number): boolean {
    if (this.calibrating) {
      this.noiseSamples.push(level);
      if (Date.now() - this.calibrationStartedAt >= this.calibrateMs) {
        this.noiseFloor = percentile(this.noiseSamples, 0.9);
        this.calibrating = false;
      }
      return false;
    }

    const threshold = this.activeThreshold;
    const release = this.releaseThreshold();
    const now = Date.now();

    if (level >= threshold || (this._confirmed && level >= release)) {
      this.belowReleaseSince = 0;

      if (!this.hearing) {
        this.hearing = true;
        this.speechStartedAt = now;
      }

      this.lastSoundAt = now;

      if (!this._confirmed && now - this.speechStartedAt >= this.speechHoldMs) {
        this._confirmed = true;
        return true;
      }
      return false;
    }

    if (this.hearing && level < release) {
      this.hearing = false;
      this.speechStartedAt = 0;
    }

    if (this._confirmed) {
      if (this.belowReleaseSince === 0) {
        this.belowReleaseSince = now;
      } else if (now - this.belowReleaseSince >= this.confirmedDecayMs) {
        this.clearConfirmed();
      }
    }

    return false;
  }

  msSinceLastSound(now = Date.now()): number {
    if (!this._confirmed || this.lastSoundAt === 0) return 0;
    return now - this.lastSoundAt;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

export const MIN_AUDIO_BLOB_BYTES = 4_000;
export const MAX_RECORDING_MS = 120_000;
export const STUCK_OPEN_MS = 90_000;

export const BARGE_IN_SPEECH_THRESHOLD = 0.08;
export const BARGE_IN_SPEECH_HOLD_MS = 200;
export const BARGE_IN_COOLDOWN_MS = 300;

export interface FixedSpeechDetectorCallbacks {
  onDetected: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

/** Fixed-threshold sustained-speech detector (legacy barge-in). */
export class FixedSpeechDetector {
  private hearingSpeech = false;
  private speechStartedAt = 0;
  private triggered = false;

  constructor(
    private readonly threshold: number,
    private readonly holdMs: number,
    private readonly callbacks: FixedSpeechDetectorCallbacks,
    private readonly triggerOnce = true,
  ) {}

  reset(): void {
    this.hearingSpeech = false;
    this.speechStartedAt = 0;
    this.triggered = false;
  }

  push(level: number): void {
    if (this.triggerOnce && this.triggered) return;

    if (level > this.threshold) {
      if (!this.hearingSpeech) {
        this.hearingSpeech = true;
        this.speechStartedAt = Date.now();
        this.callbacks.onSpeechStart?.();
      } else if (Date.now() - this.speechStartedAt >= this.holdMs) {
        this.callbacks.onDetected();
        this.triggered = true;
        this.hearingSpeech = false;
        this.speechStartedAt = 0;
      }
    } else if (this.hearingSpeech) {
      this.hearingSpeech = false;
      this.speechStartedAt = 0;
      this.callbacks.onSpeechEnd?.();
    }
  }
}
