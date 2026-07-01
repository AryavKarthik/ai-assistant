import { withAuthRoute } from "@/lib/auth/api";
import { googleSttQualityFromLegacyFields } from "@/lib/voice/google-quality";
import { transcribeAudio } from "@/lib/voice/stt";
import {
  parseGoogleSttModel,
  parseOpenAiSttModel,
  parseSttProvider,
} from "@/lib/voice/stt/types";
import { sanitizeTranscript } from "@/lib/voice/transcript-filter";
import { MIN_AUDIO_BLOB_BYTES } from "@/lib/voice/vad";
import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  return withAuthRoute(async () => {
    const contentType = request.headers.get("content-type") ?? "";

    let buffer: Buffer;
    let mimeType: string;
    let provider;
    let openAiSttModel;
    let googleSttModel;
    let googleSttQuality;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob) || audio.size === 0) {
        return NextResponse.json({ error: "audio is required" }, { status: 400 });
      }
      if (audio.size < MIN_AUDIO_BLOB_BYTES) {
        return NextResponse.json({ text: "" });
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: "audio too large" }, { status: 413 });
      }
      mimeType = audio.type || "audio/webm";
      provider = parseSttProvider(form.get("provider"));
      openAiSttModel = parseOpenAiSttModel(form.get("openAiSttModel"));
      googleSttModel = parseGoogleSttModel(form.get("googleSttModel"));
      googleSttQuality = googleSttQualityFromLegacyFields(
        form.get("googleSttQuality"),
        form.get("googleSttModel"),
      );
      buffer = Buffer.from(await audio.arrayBuffer());
    } else {
      const body = await request.json();
      const audioBase64 =
        typeof body.audio === "string" ? body.audio.trim() : "";
      mimeType =
        typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
      provider = parseSttProvider(body.provider);
      openAiSttModel = parseOpenAiSttModel(body.openAiSttModel);
      googleSttModel = parseGoogleSttModel(body.googleSttModel);
      googleSttQuality = googleSttQualityFromLegacyFields(
        body.googleSttQuality,
        body.googleSttModel,
      );

      if (!audioBase64) {
        return NextResponse.json({ error: "audio is required" }, { status: 400 });
      }

      buffer = Buffer.from(audioBase64, "base64");
      if (buffer.length < MIN_AUDIO_BLOB_BYTES) {
        return NextResponse.json({ text: "" });
      }
      if (buffer.length > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: "audio too large" }, { status: 413 });
      }
    }

    try {
      const raw = await transcribeAudio(
        { audio: buffer, mimeType },
        provider,
        { openAiModel: openAiSttModel, googleModel: googleSttModel, googleQuality: googleSttQuality },
      );
      return NextResponse.json({ text: sanitizeTranscript(raw) });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Transcription failed";
      const status = message.includes("not configured") ? 503 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
