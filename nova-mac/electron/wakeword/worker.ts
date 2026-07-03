import { parentPort, workerData } from "node:worker_threads";
import { WakeWordEngine } from "./engine";

const engine = new WakeWordEngine(workerData.modelsDir as string);
let ready = false;
engine.init().then(() => {
  ready = true;
  parentPort?.postMessage({ type: "ready" });
}).catch((err: unknown) => {
  console.error("[nova] wake engine init failed", err);
});

let workerFrameCount = 0;
// Frames MUST be processed strictly in order: engine.process() awaits three
// ONNX runs whose completions are not FIFO, so kicking one off per incoming
// message lets frames race each other and push mel rows/embeddings into the
// engine's sliding windows out of order — the temporal pattern the wake model
// matches gets scrambled and "hey jarvis" scores land inconsistently low.
let queue: Promise<void> = Promise.resolve();
parentPort?.on("message", (msg: { type: string; buf: ArrayBuffer }) => {
  if (msg.type !== "frame" || !ready) return;
  workerFrameCount++;
  const frame = new Int16Array(msg.buf);
  queue = queue
    .then(async () => {
      const score = await engine.process(frame);
      if (workerFrameCount % 100 === 0) console.log("[nova] worker processed frames:", workerFrameCount, "last score:", score);
      if (score != null) parentPort?.postMessage({ type: "score", score });
    })
    .catch((err: unknown) => {
      console.error("[nova] wake engine process error", err);
    });
});
