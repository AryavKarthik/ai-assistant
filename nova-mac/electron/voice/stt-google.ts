import { getGcpSpeechClient, isGcpVoiceConfigured } from "../gcp/client";
import { resolveGoogleSttPipeline } from "@shared/google-voices";
import { transcribeWithGoogleV2 } from "./stt-google-v2";
import type { GoogleSttModel, GoogleVoiceQuality } from "@shared/types";

function encodingForMimeType(mimeType: string): {
  encoding: "WEBM_OPUS" | "MP3" | "OGG_OPUS" | "LINEAR16";
  sampleRateHertz: number;
} {
  if (mimeType.includes("webm")) {
    return { encoding: "WEBM_OPUS", sampleRateHertz: 48000 };
  }
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return { encoding: "LINEAR16", sampleRateHertz: 48000 };
  }
  if (mimeType.includes("ogg")) {
    return { encoding: "OGG_OPUS", sampleRateHertz: 48000 };
  }
  return { encoding: "LINEAR16", sampleRateHertz: 16000 };
}

function googleSttErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

function googleSttErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isGoogleSttV2FallbackError(err: unknown): boolean {
  const message = googleSttErrorMessage(err);
  const code = googleSttErrorCode(err);
  return (
    code === "3" ||
    code === "7" ||
    message.includes("INVALID_ARGUMENT") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("NOT_FOUND") ||
    message.includes("may not exist") ||
    message.includes("speech.recognizers")
  );
}

function isGoogleSttV1RetryableError(err: unknown): boolean {
  const code = googleSttErrorCode(err);
  const message = googleSttErrorMessage(err);
  return code === "3" || message.includes("INVALID_ARGUMENT");
}

async function transcribeWithGoogleV1Config(
  audio: Buffer,
  mimeType: string,
  config: {
    model?: GoogleSttModel;
    useEnhanced?: boolean;
    alternativeLanguageCodes?: string[];
  },
): Promise<string> {
  const client = getGcpSpeechClient();
  const { encoding, sampleRateHertz } = encodingForMimeType(mimeType);

  const [response] = await client.recognize({
    config: {
      encoding,
      sampleRateHertz,
      languageCode: "en-AU",
      enableAutomaticPunctuation: true,
      ...(config.alternativeLanguageCodes
        ? { alternativeLanguageCodes: config.alternativeLanguageCodes }
        : {}),
      ...(config.model ? { model: config.model } : {}),
      ...(config.useEnhanced !== undefined
        ? { useEnhanced: config.useEnhanced }
        : {}),
    },
    audio: {
      content: audio.toString("base64"),
    },
  });

  return (
    response.results
      ?.flatMap((result) => result.alternatives ?? [])
      .map((alt) => alt.transcript ?? "")
      .join(" ")
      .trim() ?? ""
  );
}

async function transcribeWithGoogleV1(
  audio: Buffer,
  mimeType: string,
  model: GoogleSttModel,
  useEnhanced: boolean,
): Promise<string> {
  try {
    return await transcribeWithGoogleV1Config(audio, mimeType, {
      model,
      useEnhanced,
      alternativeLanguageCodes: ["en-US", "en-GB"],
    });
  } catch (err) {
    if (!isGoogleSttV1RetryableError(err)) {
      throw err;
    }

    console.warn(
      "[google-stt] V1 retry with simpler config:",
      googleSttErrorMessage(err),
    );

    return transcribeWithGoogleV1Config(audio, mimeType, {
      model,
      useEnhanced: false,
    });
  }
}

export async function transcribeWithGoogle(
  audio: Buffer,
  mimeType: string,
  quality: GoogleVoiceQuality = "medium",
): Promise<string> {
  if (!isGcpVoiceConfigured()) {
    throw new Error(
      "Google Cloud Speech is not configured. Set GCP_PROJECT_ID and GCP_SERVICE_ACCOUNT_JSON.",
    );
  }

  const pipeline = resolveGoogleSttPipeline(quality);
  const v2Model =
    pipeline.api === "v2"
      ? "chirp_2"
      : quality === "low"
        ? "short"
        : "long";
  const preferV2AutoDecode =
    mimeType.includes("mp4") ||
    mimeType.includes("m4a") ||
    pipeline.api === "v2";

  if (preferV2AutoDecode) {
    try {
      return await transcribeWithGoogleV2(audio, v2Model);
    } catch (err) {
      if (!isGoogleSttV2FallbackError(err)) {
        throw err;
      }

      console.warn(
        "[google-stt] V2 unavailable — falling back to V1:",
        googleSttErrorMessage(err),
      );

      return transcribeWithGoogleV1(
        audio,
        mimeType,
        pipeline.model === "chirp_2" ? "latest_long" : pipeline.model,
        pipeline.useEnhanced,
      );
    }
  }

  return transcribeWithGoogleV1(
    audio,
    mimeType,
    pipeline.model,
    pipeline.useEnhanced,
  );
}
