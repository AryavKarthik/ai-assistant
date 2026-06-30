/** Lowercase transcript text for phrase matching. */
export function normalizeTranscriptText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
