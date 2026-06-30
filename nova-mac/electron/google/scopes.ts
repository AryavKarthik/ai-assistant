export type GoogleService = "calendar" | "gmail" | "youtube";

const GOOGLE_SERVICES: GoogleService[] = ["calendar", "gmail", "youtube"];

export function parseGoogleService(value: string): GoogleService | null {
  return GOOGLE_SERVICES.includes(value as GoogleService)
    ? (value as GoogleService)
    : null;
}

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const OPENID_SCOPE = "openid";
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

export function parseScopes(raw: string | undefined, fallback: string): string[] {
  return (raw ?? fallback).split(/[\s,]+/).filter(Boolean);
}

export function getServiceScopes(service: GoogleService): string[] {
  switch (service) {
    case "calendar":
      return parseScopes(
        process.env.GOOGLE_CALENDAR_SCOPES,
        CALENDAR_SCOPE,
      );
    case "gmail":
      return [
        ...parseScopes(process.env.GOOGLE_GMAIL_SCOPES, GMAIL_COMPOSE_SCOPE),
        OPENID_SCOPE,
        EMAIL_SCOPE,
      ];
    case "youtube":
      return parseScopes(
        process.env.GOOGLE_YOUTUBE_SCOPES,
        YOUTUBE_SCOPE,
      );
  }
}

export function mergeScopes(
  existing: string[],
  service: GoogleService,
): string[] {
  return [...new Set([...existing, ...getServiceScopes(service)])];
}

export function hasGmailComposeScope(scopes: string[] | undefined): boolean {
  if (!scopes?.length) return false;
  return scopes.some(
    (scope) =>
      scope === GMAIL_COMPOSE_SCOPE ||
      scope === "https://www.googleapis.com/auth/gmail.modify" ||
      scope === "https://mail.google.com/",
  );
}

export function hasYoutubeReadScope(scopes: string[] | undefined): boolean {
  if (!scopes?.length) return false;
  return scopes.some(
    (scope) =>
      scope === YOUTUBE_SCOPE ||
      scope === "https://www.googleapis.com/auth/youtube",
  );
}
