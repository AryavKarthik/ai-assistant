import { SAMPLES_PER_FRAME } from "@shared/wake-constants";

/**
 * Starts 16 kHz Int16 framing from a mic MediaStream.
 * Chromium resamples the mic to 16 kHz via AudioContext.
 * Returns a stop function that tears down the audio graph.
 */
export function startWakeCapture(
  stream: MediaStream,
  send: (buf: ArrayBuffer) => void,
): () => void {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but universally supported in Electron/Chromium
  // 1 output channel required to connect to destination; output is silent (input-only processing)
  const node = ctx.createScriptProcessor(4096, 1, 1);
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
  return () => {
    node.disconnect();
    source.disconnect();
    void ctx.close();
  };
}
