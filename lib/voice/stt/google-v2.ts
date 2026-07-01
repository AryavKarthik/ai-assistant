import {
  getGcpProjectId,
  getGcpSpeechV2Client,
  getGcpSpeechV2Recognizer,
  isGcpVoiceConfigured,
} from "@/lib/gcp/client";

export async function transcribeWithGoogleV2(
  audio: Buffer,
  model: "chirp_2" | "long" | "short" = "chirp_2",
): Promise<string> {
  if (!isGcpVoiceConfigured()) {
    throw new Error(
      "Google Cloud Speech is not configured. Set GCP_PROJECT_ID and GCP_SERVICE_ACCOUNT_JSON.",
    );
  }

  if (!getGcpProjectId()) {
    throw new Error("Missing GCP project ID for Speech-to-Text V2.");
  }

  const client = getGcpSpeechV2Client();
  const [response] = await client.recognize({
    recognizer: getGcpSpeechV2Recognizer(),
    config: {
      autoDecodingConfig: {},
      languageCodes: ["en-AU"],
      model,
    },
    content: audio,
  });

  return (
    response.results
      ?.flatMap((result) => result.alternatives ?? [])
      .map((alt) => alt.transcript ?? "")
      .join(" ")
      .trim() ?? ""
  );
}
