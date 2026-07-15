import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEBOUNCE_MS = 2000;
const DEFAULT_THRESHOLD = 0.35;

/** Map wakeWordSensitivity (0 strict … 1 sensitive) to a fire threshold.
 *  0.5 (the preference default) resolves to DEFAULT_THRESHOLD.
 *
 *  Tuning history (both failure directions have happened):
 *  - 0.08…0.02 (default 0.05): tuned while the wake worker processed frames
 *    OUT OF ORDER and every score was crushed toward zero. After inference
 *    was serialized, background speech/noise commonly scored 0.05–0.2, so
 *    the orb fired on practically anything ("randomly starts listening").
 *  - 0.7…0.3 (default 0.5, openWakeWord's textbook operating point): real
 *    "hey jarvis" activations on this pipeline/mic land BELOW 0.5, so the
 *    wake word stopped firing entirely.
 *  0.55…0.15 (default 0.35) sits between the observed noise band and the
 *  genuine-activation band. The dev console prints every score above 0.001
 *  as "[nova] wake score" — say the phrase, read your actual peak, and move
 *  the Settings sensitivity slider accordingly. */
export function wakeThresholdFromSensitivity(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return 0.55 - s * 0.4; // 0.55 (strict) … 0.15 (sensitive)
}

export class WakeWordController {
  private worker: Worker | null = null;
  private enabled = true;
  private pausedForTurn = false;
  private lastFireAt = 0;
  /** Require score to drop below threshold before re-firing */
  private armed = true;
  private onWake: (() => void) | null = null;

  constructor(
    private readonly modelsDir: string = join(
      dirname(fileURLToPath(import.meta.url)),
      "models",
    ),
    private threshold = DEFAULT_THRESHOLD,
  ) {}

  setThreshold(threshold: number): void {
    this.threshold = threshold;
    console.log("[nova] wake threshold set to", threshold.toFixed(3));
  }

  start(onWake: () => void): void {
    this.onWake = onWake;
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), "worker.js");
    this.worker = new Worker(workerPath, {
      workerData: { modelsDir: this.modelsDir },
    });
    this.worker.on("message", (msg: { type: string; score?: number }) => {
      if (msg.type === "ready") { console.log("[nova] wake engine ready"); return; }
      if (msg.type !== "score" || msg.score == null) return;
      if (msg.score > 0.001) console.log("[nova] wake score", msg.score.toFixed(4));
      this.handleScore(msg.score);
    });
    this.worker.on("error", (e) => console.error("[nova] wake worker error", e));
  }

  private handleScore(score: number): void {
    if (!this.enabled || this.pausedForTurn) return;
    if (score < this.threshold) { this.armed = true; return; }
    const now = Date.now();
    if (this.armed && now - this.lastFireAt >= DEBOUNCE_MS) {
      this.armed = false;
      this.lastFireAt = now;
      this.onWake?.();
    }
  }

  private frameCount = 0;
  pushFrame(buf: ArrayBuffer): void {
    if (!this.enabled || this.pausedForTurn) return;
    this.frameCount++;
    if (this.frameCount % 50 === 0) console.log("[nova] wake frames received:", this.frameCount);
    this.worker?.postMessage({ type: "frame", buf }, [buf]);
  }

  /** Clear the worker's rolling scoring state. Without this, resuming after a
   *  pause scores new audio against an embedding window that still holds the
   *  wake phrase which started the turn — the engine re-fires on its own stale
   *  audio the moment a kill word (or any turn end) resumes scoring. FIFO port
   *  ordering guarantees the reset lands before any post-resume frame. */
  private resetEngine(): void {
    this.worker?.postMessage({ type: "reset" });
  }

  setEnabled(on: boolean): void {
    if (on && !this.enabled) this.resetEngine();
    this.enabled = on;
  }
  pauseForTurn(): void { this.pausedForTurn = true; }
  resume(): void {
    this.resetEngine();
    this.pausedForTurn = false;
    this.armed = true;
  }
}
