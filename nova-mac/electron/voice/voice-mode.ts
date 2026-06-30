export type VoiceModeName = "pipeline" | "live";
export type LiveVoiceProvider = "google-native" | "openai-realtime";

export interface VoiceMode {
  readonly name: VoiceModeName;
}

/**
 * Today's architecture: STT → Claude → TTS. The orb state machine, barge-in,
 * and wake word sit ABOVE this interface so a future `live` mode reuses them.
 */
export class PipelineVoiceMode implements VoiceMode {
  readonly name = "pipeline" as const;
}

type LiveFactory = () => VoiceMode;
const liveRegistry = new Map<LiveVoiceProvider, LiveFactory>();

/** A later phase registers a real bidirectional speech-native provider here. */
export function registerLiveVoiceProvider(provider: LiveVoiceProvider, factory: LiveFactory): void {
  liveRegistry.set(provider, factory);
}

export function getVoiceMode(mode: VoiceModeName, live?: LiveVoiceProvider): VoiceMode {
  if (mode === "pipeline") return new PipelineVoiceMode();
  const factory = live ? liveRegistry.get(live) : undefined;
  if (!factory) throw new Error("Live voice mode is not implemented in this build.");
  return factory();
}
