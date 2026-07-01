import { transcribeWithGoogle } from "@/lib/voice/stt/google";
import { transcribeWithOpenAi } from "@/lib/voice/stt/openai";
import type {
  SttProvider,
  TranscribeAudioInput,
  TranscribeOptions,
} from "@/lib/voice/stt/types";

export async function transcribeAudio(
  input: TranscribeAudioInput,
  provider: SttProvider,
  options?: TranscribeOptions,
): Promise<string> {
  if (provider === "google") {
    const quality = options?.googleQuality ?? "medium";
    return transcribeWithGoogle(input.audio, input.mimeType, quality);
  }
  return transcribeWithOpenAi(
    input.audio,
    input.mimeType,
    options?.openAiModel,
  );
}
