import { SAMPLES_PER_FRAME } from "@shared/wake-constants";

/**
 * Streams 16 kHz Int16 mono frames from a mic MediaStream to `send`.
 * Chromium resamples the mic to 16 kHz via the AudioContext.
 *
 * Capture runs in an AudioWorklet (dedicated audio thread). The previous
 * ScriptProcessorNode ran its callback on the renderer's MAIN thread — the
 * same thread animating the WebGL orb — so under UI load audio chunks arrived
 * late or got dropped entirely. Both consumers suffered: the wake engine saw
 * gapped audio (missed activations) and the streaming STT tee shipped Google
 * incomplete audio (garbled transcripts). The worklet is immune to main-thread
 * jank; a ScriptProcessor fallback remains for safety.
 *
 * Returns a stop function that tears down the audio graph.
 */
export function startWakeCapture(
  stream: MediaStream,
  send: (buf: ArrayBuffer) => void,
): () => void {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  let workletNode: AudioWorkletNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let stopped = false;

  // A suspended context produces NO frames — wake word and streaming STT both
  // go silently dead. Resume eagerly and whenever the state flips.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  ctx.onstatechange = () => {
    if (!stopped && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };

  const workletUrl = URL.createObjectURL(
    new Blob([captureWorkletSource(SAMPLES_PER_FRAME)], { type: "application/javascript" }),
  );

  ctx.audioWorklet
    .addModule(workletUrl)
    .then(() => {
      if (stopped) return;
      workletNode = new AudioWorkletNode(ctx, "nova-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => send(e.data);
      source.connect(workletNode);
      workletNode.connect(ctx.destination);
      console.log("[wake-capture] AudioWorklet capture active");
    })
    .catch((err) => {
      console.warn("[wake-capture] AudioWorklet unavailable, falling back to ScriptProcessor:", err);
      if (stopped) return;
      scriptNode = startScriptProcessorFallback(ctx, source, send);
    })
    .finally(() => URL.revokeObjectURL(workletUrl));

  return () => {
    stopped = true;
    workletNode?.port.close();
    workletNode?.disconnect();
    scriptNode?.disconnect();
    source.disconnect();
    void ctx.close();
  };
}

/** Worklet source, inlined as a blob so no bundler asset plumbing is needed.
 *  Accumulates 128-sample render quanta into SAMPLES_PER_FRAME Int16 frames
 *  and transfers them to the main thread. */
function captureWorkletSource(samplesPerFrame: number): string {
  return `
class NovaPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${samplesPerFrame});
    this.filled = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let offset = 0;
    while (offset < ch.length) {
      const take = Math.min(ch.length - offset, ${samplesPerFrame} - this.filled);
      this.buf.set(ch.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === ${samplesPerFrame}) {
        const out = new Int16Array(${samplesPerFrame});
        for (let i = 0; i < ${samplesPerFrame}; i++) {
          const s = Math.max(-1, Math.min(1, this.buf[i]));
          out[i] = s < 0 ? s * 32768 : s * 32767;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("nova-pcm-capture", NovaPcmCapture);
`;
}

function startScriptProcessorFallback(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  send: (buf: ArrayBuffer) => void,
): ScriptProcessorNode {
  // 2048 samples @ 16 kHz = 128 ms per callback.
  const node = ctx.createScriptProcessor(2048, 1, 1);
  let acc: number[] = [];

  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) acc.push(input[i]!);
    while (acc.length >= SAMPLES_PER_FRAME) {
      const chunk = acc.slice(0, SAMPLES_PER_FRAME);
      acc = acc.slice(SAMPLES_PER_FRAME);
      const i16 = new Int16Array(SAMPLES_PER_FRAME);
      for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]!));
        i16[i] = s < 0 ? s * 32768 : s * 32767;
      }
      send(i16.buffer);
    }
  };

  source.connect(node);
  node.connect(ctx.destination);
  return node;
}
