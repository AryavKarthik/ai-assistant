import { getGcpTtsClient, isGcpVoiceConfigured } from "@/lib/gcp/client";
import {
  normalizeGoogleTtsVoice,
} from "@/lib/voice/google-quality";
import type { GoogleVoiceQuality } from "@/lib/voice/types";

export async function synthesizeWithGoogle(
  text: string,
  voice: string,
  speed: number,
  quality: GoogleVoiceQuality = "high",
): Promise<Buffer> {
  if (!isGcpVoiceConfigured()) {
    throw new Error(
      "Google Cloud Text-to-Speech is not configured. Set GCP_PROJECT_ID and GCP_SERVICE_ACCOUNT_JSON.",
    );
  }

  const voiceName = normalizeGoogleTtsVoice(voice, quality);

  const client = getGcpTtsClient();
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: voiceName.slice(0, 5),
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: speed,
      pitch: 0,
      effectsProfileId: ["headphone-class-device"],
    },
  });

  if (!response.audioContent) {
    throw new Error("Google TTS returned empty audio.");
  }

  return Buffer.from(response.audioContent as Uint8Array);
}
