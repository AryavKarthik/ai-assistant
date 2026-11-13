import { plainTextForSpeech } from "./tts-text";

// (plainTextForSpeech collapses newlines to spaces, so unpunctuated lists are
// bounded by MAX_CHUNK_CHARS below rather than by line breaks.)
const SENTENCE_END = /[.!?](?:\s+|$)/;
const CLAUSE_END = /,(?:\s+|$)/;
/** Upper bound for one TTS request; longer text is split at a space. */
const MAX_CHUNK_CHARS = 160;

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
    let remaining = newPlain;

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
          // Keep chunking the rest of this push. Returning here left every
          // later sentence of a big push (e.g. a whole reply fed at once on
          // resume) to come out of flush() as ONE huge TTS request.
          remaining = newPlain.slice(splitAt);
        }
      }
    }

    // start = beginning of the pending (unemitted) text; scan = where to look
    // for the next boundary. A too-short sentence ("Yeah.") is merged with the
    // following one instead of stalling: the old loop broke out there, so all
    // later text piled up until flush() as one giant chunk.
    let start = 0;
    let scan = 0;
    while (scan < remaining.length) {
      const rest = remaining.slice(scan);
      const sentenceMatch = rest.match(SENTENCE_END);
      const clauseMatch =
        remaining.length - start >= this.clauseBreakAfter ? rest.match(CLAUSE_END) : null;
      const match = sentenceMatch ?? clauseMatch;

      if (!match || match.index === undefined) {
        // No boundary yet. If the pending text is already long (lists, run-on
        // sentences with no punctuation), cut at a space so no single TTS
        // request gets huge (a 523-char chunk took ~3.9s to synthesize).
        if (remaining.length - start > MAX_CHUNK_CHARS) {
          const cut = remaining.lastIndexOf(" ", start + MAX_CHUNK_CHARS);
          const end = cut > start + this.minChars ? cut : start + MAX_CHUNK_CHARS;
          this.emit(sentences, remaining.slice(start, end));
          start = end;
          scan = end;
          continue;
        }
        break;
      }

      const end = scan + match.index + match[0].length;
      const candidate = remaining.slice(start, end).trim();
      if (candidate.length >= this.minChars) {
        this.emit(sentences, candidate);
        start = end;
      }
      scan = end;
    }
    this.plainCursor += start;

    return sentences;
  }

  /** Adds a chunk, splitting anything over MAX_CHUNK_CHARS at spaces. */
  private emit(out: string[], text: string): void {
    let rest = text.trim();
    while (rest.length > MAX_CHUNK_CHARS) {
      const cut = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
      const end = cut > this.minChars ? cut : MAX_CHUNK_CHARS;
      out.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) out.push(rest);
    this.firstChunkEmitted = true;
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
