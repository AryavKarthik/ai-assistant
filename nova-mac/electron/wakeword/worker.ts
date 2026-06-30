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
parentPort?.on("message", (msg: { type: string; buf: ArrayBuffer }) => {
  if (msg.type !== "frame" || !ready) return;
  workerFrameCount++;
  const frame = new Int16Array(msg.buf);
  engine.process(frame).then((score) => {
    if (workerFrameCount % 100 === 0) console.log("[nova] worker processed frames:", workerFrameCount, "last score:", score);
    if (score != null) parentPort?.postMessage({ type: "score", score });
  }).catch((err: unknown) => {
    console.error("[nova] wake engine process error", err);
  });
});
