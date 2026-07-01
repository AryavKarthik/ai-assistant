// Messages sent to Claude and shown in the active conversation UI.
export const CHAT_HISTORY_LIMIT = 40;

// Main chat threads are cleared after this age (rolling window from created_at).
export const MAIN_CHAT_TTL_MS = 24 * 60 * 60 * 1000;
