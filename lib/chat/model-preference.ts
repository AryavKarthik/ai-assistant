const MODEL_PREFERENCE_KEY = "ai-assistant-pinned-model";

export function loadModelPreference(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(MODEL_PREFERENCE_KEY);
}

export function saveModelPreference(model: string | null) {
  if (typeof window === "undefined") return;
  if (model) {
    localStorage.setItem(MODEL_PREFERENCE_KEY, model);
  } else {
    localStorage.removeItem(MODEL_PREFERENCE_KEY);
  }
}
