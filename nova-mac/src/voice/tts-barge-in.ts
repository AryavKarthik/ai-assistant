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
  // Stricter than the original mapping (hold 380-250ms, minLevel 0.08-0.058,
  // spike 0.035-0.021): those let Nova's own voice leaking from the speakers
  // into the mic read as an interrupt, so replies cut out and restarted.
  // At the default 0.45: hold ~510ms, minLevel ~0.092, spike ~0.047.
  return {
    cooldownMs: Math.round(1200 - s * 350),
    holdMs: Math.round(600 - s * 200),
    minLevel: 0.11 - s * 0.04,
    spikeDelta: 0.06 - s * 0.03,
  };
}

/** A dip longer than this while "hearing" restarts the hold: the hold must be
 *  near-continuous speech, not scattered loud blips. */
const HOLD_GAP_MS = 150;

export class TtsBargeInListener {
  private analyser = new MicAnalyser();
  private disposed = false;
  private cooldownUntil = 0;
  private baseline = 0;
  private hearing = false;
  private heardAt = 0;
  private lastAboveAt = 0;
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
        if (level >= minLevel && spike >= spikeDelta) {
          this.hearing = true;
          this.heardAt = now;
          this.lastAboveAt = now;
          this.frozenBaseline = this.baseline;
        }
        return;
      }

      if (level >= minLevel && level - this.frozenBaseline >= spikeDelta) {
        this.lastAboveAt = now;
        if (now - this.heardAt >= holdMs) {
          this.triggered = true;
          this.stop();
          onBargeIn();
        }
        return;
      }

      // Previously a hold only needed ONE loud frame after holdMs had passed
      // since the first blip, with quiet frames in between ignored — bursty
      // TTS echo satisfied that easily. Now any dip longer than HOLD_GAP_MS
      // restarts it, so only sustained speech over the reply interrupts.
      if (now - this.lastAboveAt > HOLD_GAP_MS) {
        this.hearing = false;
      }
    });
  }

  stop(): void {
    this.disposed = true;
    this.analyser.stop();
  }
}
