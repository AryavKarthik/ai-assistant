/** Human-readable label for an Anthropic model slug shown in chat UI. */
export function formatModelLabel(model: string): string {
  const slug = model.toLowerCase();

  if (slug.includes("haiku")) {
    return slug.includes("4-5") || slug.includes("4.5")
      ? "Claude Haiku 4.5"
      : "Claude Haiku";
  }
  if (slug.includes("sonnet")) {
    return slug.includes("4-5") || slug.includes("4.5")
      ? "Claude Sonnet 4.5"
      : slug.includes("4-0") || slug.includes("4.0")
        ? "Claude Sonnet 4"
        : "Claude Sonnet";
  }
  if (slug.includes("opus")) {
    return "Claude Opus";
  }

  return model;
}
