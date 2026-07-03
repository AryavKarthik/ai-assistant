import { existsSync, readFileSync } from "node:fs";
import { SpeechClient } from "@google-cloud/speech";
import { v2 as speechV2 } from "@google-cloud/speech";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";

/** Regional endpoint for Speech-to-Text V2 (Chirp 2). */
export const GCP_SPEECH_V2_LOCATION =
  process.env.GCP_SPEECH_V2_LOCATION?.trim() || "asia-southeast1";

let speechClient: SpeechClient | null = null;
let speechV2Client: speechV2.SpeechClient | null = null;
let ttsClient: TextToSpeechClient | null = null;

function loadCredentialsFromPath(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.error("[gcp] Failed to read credentials file:", err);
    return null;
  }
}

function parseServiceAccountJson(): Record<string, unknown> | null {
  const path =
    process.env.GCP_SERVICE_ACCOUNT_JSON_PATH?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    const fromFile = loadCredentialsFromPath(path);
    if (fromFile) return fromFile;
  }

  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error(
      "[gcp] Failed to parse GCP_SERVICE_ACCOUNT_JSON — use a single-line JSON string or set GOOGLE_APPLICATION_CREDENTIALS to a key file path",
    );
    return null;
  }
}

export function getGcpProjectId(): string | null {
  const fromEnv = process.env.GCP_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;

  const credentials = parseServiceAccountJson();
  const projectId =
    credentials && typeof credentials.project_id === "string"
      ? credentials.project_id
      : null;
  return projectId;
}

export function isGcpVoiceConfigured(): boolean {
  return Boolean(getGcpProjectId() && parseServiceAccountJson());
}

function getClientOptions() {
  const credentials = parseServiceAccountJson();
  if (credentials) {
    return { credentials };
  }
  return {};
}

export function getGcpSpeechClient(): SpeechClient {
  if (!speechClient) {
    speechClient = new SpeechClient(getClientOptions());
  }
  return speechClient;
}

export function getGcpSpeechV2Client(): speechV2.SpeechClient {
  if (!speechV2Client) {
    const projectId = getGcpProjectId();
    if (!projectId) {
      throw new Error("Missing GCP project ID for Speech-to-Text V2.");
    }

    speechV2Client = new speechV2.SpeechClient({
      ...getClientOptions(),
      apiEndpoint: `${GCP_SPEECH_V2_LOCATION}-speech.googleapis.com`,
    });
  }
  return speechV2Client;
}

export function getGcpSpeechV2Recognizer(): string {
  const projectId = getGcpProjectId();
  if (!projectId) {
    throw new Error("Missing GCP project ID for Speech-to-Text V2.");
  }
  return `projects/${projectId}/locations/${GCP_SPEECH_V2_LOCATION}/recognizers/_`;
}

export function getGcpTtsClient(): TextToSpeechClient {
  if (!ttsClient) {
    ttsClient = new TextToSpeechClient(getClientOptions());
  }
  return ttsClient;
}
