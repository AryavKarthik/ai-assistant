import type { SpeechGateOptions } from "@/lib/voice/vad";

/** Map 0 (strict) … 1 (loose) sensitivity to SpeechGate thresholds. */
export function speechGateOptionsFromSensitivity(
  sensitivity: number,
  options?: { warm?: boolean; noiseFloor?: number; bargeInProbe?: boolean },
): SpeechGateOptions {
  const s = Math.max(0, Math.min(1, sensitivity));
  const strict = options?.bargeInProbe ? Math.min(1, s + 0.35) : s;
  return {
    minThreshold: 0.08 + (1 - strict) * 0.08,
    noiseMargin: 0.04 + (1 - strict) * 0.03,
    speechHoldMs: options?.bargeInProbe
      ? 180 + Math.round((1 - strict) * 80)
      : 320 + Math.round((1 - s) * 100),
    calibrateMs: options?.bargeInProbe
      ? options?.warm
        ? 100
        : 200
      : options?.warm
        ? 150
        : 320,
    confirmedDecayMs: 2000,
    initialNoiseFloor: options?.warm ? options.noiseFloor : undefined,
  };
}
