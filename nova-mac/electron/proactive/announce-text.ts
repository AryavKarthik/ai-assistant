import Anthropic from "@anthropic-ai/sdk";
import { PERSONALITY_PROMPT } from "../memory/system-prompt";
import { getPersonalityBlock } from "../personality/store";

// Proactive announcements used to be flat templates ("Timer's done — pasta.")
// which read as a different, robotic voice next to Nova's chat personality.
// A quick light-model call writes each spoken line in-character instead; the
// template stays as the fallback (API error, no key, slow response).

const LIGHT_MODEL = process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5-20251001";
const GENERATION_TIMEOUT_MS = 6_000;

let anthropic: Anthropic | null = null;
function client(): Anthropic | null {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const ANNOUNCER_PROMPT = `${PERSONALITY_PROMPT}

Right now you're speaking ONE proactive spoken line out loud — you noticed something (a timer finishing, a reminder coming due, an event starting soon) and you're telling the user unprompted. Rules:
- One or two short spoken sentences, under ~30 words total. No markdown, no emoji — it's read aloud by TTS.
- MUST include the concrete fact you're announcing (what it is, and the time/lead if given). Don't bury it.
- Personality fully on: casual, a bit of flavour, like a mate leaning over to tell you something. Vary your phrasing — never a canned template.
- The user may reply right after you speak, so it's fine to end with a tiny hook ("want me to snooze it?") — but only sometimes, not every line.
Reply with the spoken line only.`;

/** Writes the spoken line for a proactive announcement in Nova's voice.
 *  Falls back to `fallback` (the plain template) on any failure. */
export async function generateSpokenAnnouncement(
  kind: "reminder" | "calendar" | "timer",
  fact: string,
  fallback: string,
): Promise<string> {
  const c = client();
  if (!c) return fallback;
  try {
    const result = await Promise.race([
      c.messages.create({
        model: LIGHT_MODEL,
        max_tokens: 100,
        system: ANNOUNCER_PROMPT + getPersonalityBlock(),
        messages: [{ role: "user", content: `Announce this ${kind}: ${fact}` }],
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GENERATION_TIMEOUT_MS)),
    ]);
    if (!result) return fallback;
    const text = result.content
      .filter((b): b is Extract<(typeof result.content)[number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}
