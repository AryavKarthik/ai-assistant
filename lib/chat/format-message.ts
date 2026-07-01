// Defensive cleanup before rendering assistant markdown.
export function normalizeAssistantMarkdown(text: string): string {
  let normalized = text.replace(/\r\n/g, "\n");

  normalized = stripEmDashes(normalized);

  // Collapse triple-emphasis stacks into bold.
  normalized = normalized.replace(/\*\*\*([^*]+)\*\*\*/g, "**$1**");

  // Remove stray triple asterisks.
  normalized = normalized.replace(/\*{3,}/g, "**");

  // Collapse long horizontal rule runs.
  normalized = normalized.replace(/-{4,}/g, "---");

  // Trim excessive blank lines (keep at most one blank line between blocks).
  normalized = normalized.replace(/\n{3,}/g, "\n\n");

  return normalized.trim();
}

function stripEmDashes(text: string): string {
  // Preserve numeric ranges (e.g. 10–15) as hyphens.
  let cleaned = text.replace(/(\d)\u2013(\d)/g, "$1-$2");

  // Em dash and remaining en dash → comma or sentence break.
  cleaned = cleaned.replace(/\s*\u2014\s*/g, ", ");
  cleaned = cleaned.replace(/\s*\u2013\s*/g, ", ");

  // Collapse ", ," and tidy ",." / ",,"
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/,\s*\./g, ".");
  return cleaned;
}

// Close dangling markdown markers during streaming so partial text renders cleanly.
export function stabilizeStreamingMarkdown(text: string): string {
  let stable = normalizeAssistantMarkdown(text);

  const pairs: Array<[string, string]> = [
    ["**", "**"],
    ["_", "_"],
    ["`", "`"],
  ];

  for (const [open, close] of pairs) {
    const count = stable.split(open).length - 1;
    if (count % 2 !== 0) {
      stable += close;
    }
  }

  const fenceCount = (stable.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    stable += "\n```";
  }

  return stable;
}
