import * as ort from "onnxruntime-node";
import { join } from "node:path";
import {
  AudioRingBuffer,
  WindowAccumulator,
  SAMPLES_PER_FRAME,
  MEL_BINS,
  MEL_FRAMES_PER_EMBEDDING,
  EMBEDDINGS_PER_PREDICTION,
} from "./framing";

export class WakeWordEngine {
  private mel!: ort.InferenceSession;
  private embed!: ort.InferenceSession;
  private wake!: ort.InferenceSession;
  private ring = new AudioRingBuffer();
  private melWindow = new WindowAccumulator(MEL_FRAMES_PER_EMBEDDING, MEL_BINS);
  private embWindow = new WindowAccumulator(EMBEDDINGS_PER_PREDICTION, 96);
  private loggedFirstFrame = false;

  constructor(private readonly modelsDir: string) {}

  async init(): Promise<void> {
    this.mel = await ort.InferenceSession.create(join(this.modelsDir, "melspectrogram.onnx"));
    this.embed = await ort.InferenceSession.create(join(this.modelsDir, "embedding_model.onnx"));
    this.wake = await ort.InferenceSession.create(join(this.modelsDir, "hey_jarvis_v0.1.onnx"));
  }

  /** Push one ~80ms Int16 frame; returns a wake score when a full prediction window is ready. */
  async process(frame: Int16Array): Promise<number | null> {
    this.ring.pushInt16(frame);
    const samples = this.ring.take(SAMPLES_PER_FRAME);
    if (!samples) return null;

    // 1) raw audio → mel frames (shape [1, N] → [1, melFrames, MEL_BINS])
    const melIn = new ort.Tensor("float32", samples, [1, samples.length]);
    const melOut = await this.mel.run({ [this.mel.inputNames[0]!]: melIn });
    const melTensor = melOut[this.mel.outputNames[0]!]!;
    // Apply openWakeWord normalization: matches Python `spec = (spec / 10) + 2`
    // Raw log-mel values are in ~[-60, 0] dB; this maps them to ~[-4, 2] for the embedding model.
    const melData = Float32Array.from(melTensor.data as Float32Array, (v) => v / 10 + 2);
    const melFrames = melData.length / MEL_BINS;

    if (!this.loggedFirstFrame) {
      this.loggedFirstFrame = true;
      const raw = melTensor.data as Float32Array;
      console.log("[nova] mel inputNames:", this.mel.inputNames, "outputNames:", this.mel.outputNames);
      console.log("[nova] mel output dims:", melTensor.dims, "frames:", melFrames, "bins:", MEL_BINS);
      console.log("[nova] mel raw range:", Math.min(...raw).toFixed(2), "to", Math.max(...raw).toFixed(2));
      console.log("[nova] mel normalized range:", Math.min(...melData).toFixed(2), "to", Math.max(...melData).toFixed(2));
      console.log("[nova] embed inputNames:", this.embed.inputNames, "outputNames:", this.embed.outputNames);
      console.log("[nova] wake inputNames:", this.wake.inputNames, "outputNames:", this.wake.outputNames);
    }

    let lastScore: number | null = null;
    for (let f = 0; f < melFrames; f++) {
      const row = new Float32Array(melData.buffer, melData.byteOffset + f * MEL_BINS * 4, MEL_BINS);
      const melWin = this.melWindow.push(row);
      if (!melWin) continue;

      // 2) 76×32 mel window → 96-d embedding
      const embIn = new ort.Tensor("float32", melWin, [1, MEL_FRAMES_PER_EMBEDDING, MEL_BINS, 1]);
      const embOut = await this.embed.run({ [this.embed.inputNames[0]!]: embIn });
      const emb = Float32Array.from((embOut[this.embed.outputNames[0]!]!.data as Float32Array));
      const embWin = this.embWindow.push(emb);
      if (!embWin) continue;

      // 3) 16×96 embeddings → wake score
      const wakeIn = new ort.Tensor("float32", embWin, [1, EMBEDDINGS_PER_PREDICTION, 96]);
      const wakeOut = await this.wake.run({ [this.wake.inputNames[0]!]: wakeIn });
      lastScore = (wakeOut[this.wake.outputNames[0]!]!.data as Float32Array)[0]!;
    }
    return lastScore;
  }
}
