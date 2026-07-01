const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "it",
  "its",
  "they",
  "them",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "and",
  "but",
  "if",
  "or",
  "because",
  "until",
  "while",
  "about",
  "against",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "how",
  "when",
  "where",
  "why",
]);

const EXERCISE_KEYWORDS = [
  "workout",
  "gym",
  "exercise",
  "bench press",
  "bench",
  "squat",
  "deadlift",
  "overhead press",
  "curl",
  "running",
  "cardio",
  "lifting",
  "reps",
  "sets",
];

export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSignificantTerms(text: string, limit = 10): string[] {
  const words = normalizeContent(text).split(/\s+/);
  const terms: string[] = [];

  for (const word of words) {
    if (word.length <= 2 || STOP_WORDS.has(word)) continue;
    if (!terms.includes(word)) terms.push(word);
    if (terms.length >= limit) break;
  }

  return terms;
}

export function extractSearchTerms(text: string): string[] {
  return extractSignificantTerms(text, 10);
}

const TERM_CLUSTERS: Record<string, string[]> = {
  education: [
    "school",
    "university",
    "college",
    "studying",
    "student",
    "degree",
    "major",
    "course",
    "exam",
    "class",
    "lecture",
    "homework",
    "assignment",
    "semester",
    "bachelor",
    "commerce",
  ],
  work: ["job", "work", "employer", "office", "career", "role", "company"],
  location: ["live", "lives", "city", "town", "country", "moved", "relocated"],
};

// Expand query terms so "exam" also retrieves education memories, etc.
export function expandSearchTerms(terms: string[]): string[] {
  const expanded = new Set(terms);

  for (const term of terms) {
    for (const members of Object.values(TERM_CLUSTERS)) {
      if (!members.includes(term)) continue;
      for (const member of members) {
        expanded.add(member);
      }
    }
  }

  return [...expanded];
}

export function isExerciseRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return EXERCISE_KEYWORDS.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(lower);
  });
}

const WORKOUT_RECALL_KEYWORDS = [
  "workout",
  "gym",
  "training",
  "exercise",
  "lift",
  "lifting",
  "progress",
  "personal best",
  "pr ",
  "reps",
  "sets",
];

export function isWorkoutRecallRelated(text: string): boolean {
  if (isExerciseRelated(text)) return true;
  const lower = text.toLowerCase();
  return WORKOUT_RECALL_KEYWORDS.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(lower);
  });
}

export function formatWorkoutLine(workout: {
  logged_at: string;
  exercise: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  duration_min: number | null;
  notes: string | null;
}): string {
  const date = workout.logged_at.split("T")[0];
  const parts = [workout.exercise];

  if (workout.sets && workout.reps) {
    parts.push(`${workout.sets}x${workout.reps}`);
  }
  if (workout.weight_kg) {
    parts.push(`@ ${workout.weight_kg}kg`);
  }
  if (workout.duration_min) {
    parts.push(`${workout.duration_min}min`);
  }
  if (workout.notes) {
    parts.push(`(${workout.notes})`);
  }

  return `- [workout] ${date} ${parts.join(" ")}`;
}
