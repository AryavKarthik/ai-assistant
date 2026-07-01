export const GMAIL_NOT_CONNECTED =
  "Gmail not linked. Connect at /connections.";
export const GMAIL_COMPOSE_SCOPE_ERROR =
  "Gmail is connected but missing send permission. Reconnect Gmail in Connections to enable drafting and sending.";
export const CALENDAR_NOT_CONNECTED =
  "Google Calendar not linked. Connect at /connections.";
export const YOUTUBE_NOT_CONNECTED =
  "YouTube not linked. Connect at /connections.";
export const YOUTUBE_MISSING_SCOPE_ERROR =
  "YouTube is connected but missing permission. Reconnect YouTube in Connections to re-consent.";

export function isInsufficientScopeError(message: string): boolean {
  return /insufficient authentication scopes/i.test(message);
}

export function isGmailPermissionError(message: string): boolean {
  return (
    /not linked/i.test(message) || /missing send permission/i.test(message)
  );
}

export function isMissingScopeMessage(message: string): boolean {
  return (
    /missing permission|insufficient authentication scopes|missing send permission/i.test(
      message,
    )
  );
}
