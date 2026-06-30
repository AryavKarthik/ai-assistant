import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEBOUNCE_MS = 2000;

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
    private readonly threshold = 0.05,
  ) {}

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

  setEnabled(on: boolean): void { this.enabled = on; }
  pauseForTurn(): void { this.pausedForTurn = true; }
  resume(): void { this.pausedForTurn = false; this.armed = true; }
}
