/**
 * Listens for user speech only while TTS is playing (hands-free interrupt).
 * Mic-hold interrupt bypasses this and is handled directly in the voice session.
 */

import { MicAnalyser } from "./mic-analyser";

export interface TtsBargeInConfig {
  cooldownMs: number;
  holdMs: number;
  minLevel: number;
  spikeDelta: number;
}

/** Map 0 (strict/slow) … 1 (fast/sensitive) to listener thresholds. */
export function ttsBargeInConfigFromSensitivity(
  sensitivity: number,
): TtsBargeInConfig {
  const s = Math.max(0, Math.min(1, sensitivity));
  return {
    cooldownMs: Math.round(1100 - s * 350),
    holdMs: Math.round(380 - s * 130),
    minLevel: 0.08 - s * 0.022,
    spikeDelta: 0.035 - s * 0.014,
  };
}

export class TtsBargeInListener {
  private analyser = new MicAnalyser();
  private disposed = false;
  private cooldownUntil = 0;
  private baseline = 0;
  private hearing = false;
  private heardAt = 0;
  private frozenBaseline = 0;
  private triggered = false;
  private config: TtsBargeInConfig;

  constructor(config?: TtsBargeInConfig) {
    this.config = config ?? ttsBargeInConfigFromSensitivity(0.45);
  }

  start(stream: MediaStream, onBargeIn: () => void): void {
    this.stop();
    this.disposed = false;
    this.triggered = false;
    this.cooldownUntil = Date.now() + this.config.cooldownMs;
    this.baseline = 0;
    this.hearing = false;

    const { holdMs, minLevel, spikeDelta } = this.config;

    this.analyser.start(stream, (level) => {
      if (this.disposed || this.triggered) return;
      const now = Date.now();

      if (now < this.cooldownUntil) {
        this.baseline =
          this.baseline === 0 ? level : this.baseline * 0.8 + level * 0.2;
        return;
      }

      if (!this.hearing) {
        this.baseline = this.baseline * 0.985 + level * 0.015;
      }

      const reference = this.hearing ? this.frozenBaseline : this.baseline;
      const spike = level - reference;

      if (!this.hearing) {
        if (level >= minLevel && spike >= spikeDelta * 0.55) {
          this.hearing = true;
          this.heardAt = now;
          this.frozenBaseline = this.baseline;
        }
        return;
      }

      if (level >= minLevel && level - this.frozenBaseline >= spikeDelta) {
        if (now - this.heardAt >= holdMs) {
          this.triggered = true;
          this.stop();
          onBargeIn();
        }
        return;
      }

      if (level - this.frozenBaseline < spikeDelta * 0.35) {
        this.hearing = false;
      }
    });
  }

  stop(): void {
    this.disposed = true;
    this.analyser.stop();
  }
}
