import { withAuthRoute } from "@/lib/auth/api";
import { synthesizeWithDeepgram } from "@/lib/voice/tts/deepgram-server";
import { synthesizeWithGoogle } from "@/lib/voice/tts/google-server";
import { synthesizeWithOpenAi } from "@/lib/voice/tts/openai-server";
import {
  MAX_TTS_CHARS,
  parseGoogleVoiceQuality,
  parseOpenAiTtsModel,
  parseTtsProvider,
} from "@/lib/voice/tts/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return withAuthRoute(async () => {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voice = typeof body.voice === "string" ? body.voice : "nova";
    const speed =
      typeof body.speed === "number" && body.speed >= 0.25 && body.speed <= 4
        ? body.speed
        : 1;
    const useHd = body.hd === true;
    const provider = parseTtsProvider(body.provider);
    const openAiTtsModel = parseOpenAiTtsModel(body.openAiTtsModel);
    const googleTtsQuality = parseGoogleVoiceQuality(body.googleTtsQuality);

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (text.length > MAX_TTS_CHARS) {
      return NextResponse.json(
        { error: `text exceeds ${MAX_TTS_CHARS} characters per request` },
        { status: 400 },
      );
    }

    try {
      if (provider === "google") {
        const audio = await synthesizeWithGoogle(text, voice, speed, googleTtsQuality);
        return new NextResponse(new Uint8Array(audio), {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }

      if (provider === "deepgram") {
        const stream = await synthesizeWithDeepgram(text, voice);
        return new NextResponse(stream as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }

      const audio = await synthesizeWithOpenAi(text, voice, speed, useHd, openAiTtsModel);
      return new NextResponse(new Uint8Array(audio), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Speech synthesis failed";
      const status = message.includes("not configured") ? 503 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
