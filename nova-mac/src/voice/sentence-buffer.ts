import { plainTextForSpeech } from "./tts-text";

const SENTENCE_END = /[.!?](?:\s+|$)/;
const CLAUSE_END = /,(?:\s+|$)/;

export interface SentenceBufferOptions {
  minChars?: number;
  clauseBreakAfter?: number;
  firstChunkMinChars?: number;
}

/** Accumulates streamed text and emits complete spoken sentences. */
export class SentenceBuffer {
  private raw = "";
  private plain = "";
  private plainCursor = 0;
  private minChars: number;
  private clauseBreakAfter: number;
  private firstChunkMinChars: number;
  private firstChunkEmitted = false;

  constructor(options?: SentenceBufferOptions) {
    this.minChars = options?.minChars ?? 20;
    this.clauseBreakAfter = options?.clauseBreakAfter ?? 80;
    this.firstChunkMinChars = options?.firstChunkMinChars ?? 12;
  }

  push(delta: string): string[] {
    this.raw += delta;
    const nextPlain = plainTextForSpeech(this.raw);
    const newPlain = nextPlain.slice(this.plainCursor);
    this.plain = nextPlain;

    if (!newPlain) return [];

    const sentences: string[] = [];

    if (
      !this.firstChunkEmitted &&
      newPlain.length >= this.firstChunkMinChars
    ) {
      const sentenceMatch = newPlain.match(SENTENCE_END);
      let splitAt = -1;
      if (
        sentenceMatch &&
        sentenceMatch.index !== undefined &&
        sentenceMatch.index + sentenceMatch[0].length >= this.firstChunkMinChars
      ) {
        splitAt = sentenceMatch.index + sentenceMatch[0].length;
      } else if (newPlain.length >= 48) {
        const space = newPlain.lastIndexOf(" ", 48);
        splitAt = space >= this.firstChunkMinChars ? space : 48;
      }

      if (splitAt > 0) {
        const first = newPlain.slice(0, splitAt).trim();
        if (first.length >= this.firstChunkMinChars) {
          sentences.push(first);
          this.plainCursor += splitAt;
          this.firstChunkEmitted = true;
          return sentences;
        }
      }
    }

    let remaining = newPlain;

    while (remaining.length > 0) {
      const sentenceMatch = remaining.match(SENTENCE_END);
      const clauseMatch =
        remaining.length >= this.clauseBreakAfter
          ? remaining.match(CLAUSE_END)
          : null;
      const match = sentenceMatch ?? clauseMatch;

      if (!match || match.index === undefined) break;

      const endIndex = match.index + match[0].length;
      const candidate = remaining.slice(0, endIndex).trim();
      remaining = remaining.slice(endIndex);

      if (candidate.length >= this.minChars) {
        sentences.push(candidate);
        this.plainCursor += endIndex;
        this.firstChunkEmitted = true;
      } else if (candidate.length > 0) {
        remaining = candidate + remaining;
        break;
      }
    }

    return sentences;
  }

  flush(): string | null {
    const tail = this.plain.slice(this.plainCursor).trim();
    this.plainCursor = this.plain.length;
    return tail || null;
  }

  reset(): void {
    this.raw = "";
    this.plain = "";
    this.plainCursor = 0;
    this.firstChunkEmitted = false;
  }
}
