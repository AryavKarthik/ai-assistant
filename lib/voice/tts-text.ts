import { MAX_TTS_CHARS } from "@/lib/voice/tts/types";

// Google TTS rejects individual sentences exceeding this length.
const MAX_SENTENCE_CHARS = 300;

/** Prepare assistant markdown for natural TTS. */
export function plainTextForSpeech(markdown: string): string {
  let text = markdown;

  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/\|/g, " ");
  text = text.replace(/\s+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.replace(/\s+/g, " ").trim();
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence];

  const parts: string[] = [];
  let remaining = sentence;

  while (remaining.length > MAX_SENTENCE_CHARS) {
    let splitAt = remaining.lastIndexOf(", ", MAX_SENTENCE_CHARS);
    if (splitAt < MAX_SENTENCE_CHARS * 0.4) {
      splitAt = remaining.lastIndexOf("; ", MAX_SENTENCE_CHARS);
    }
    if (splitAt < MAX_SENTENCE_CHARS * 0.4) {
      splitAt = remaining.lastIndexOf(" ", MAX_SENTENCE_CHARS);
    }
    if (splitAt < 1) {
      splitAt = MAX_SENTENCE_CHARS;
    }

    const part = remaining.slice(0, splitAt).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by a space or end of string.
  return text.split(/(?<=[.!?])\s+/).flatMap(splitLongSentence);
}

function chunkTextForSpeech(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentences = splitIntoSentences(trimmed);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > MAX_TTS_CHARS) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function prepareSpeechChunks(markdown: string): string[] {
  return chunkTextForSpeech(plainTextForSpeech(markdown));
}
