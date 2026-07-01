import type { GoogleService } from "@/lib/google/scopes";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function getGoogleClientId(): string {
  return requireEnv("GOOGLE_CLIENT_ID");
}

export function getGoogleClientSecret(): string {
  return requireEnv("GOOGLE_CLIENT_SECRET");
}

export function getRedirectUriForService(service: GoogleService): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  switch (service) {
    case "calendar":
      return (
        process.env.GOOGLE_REDIRECT_URI ??
        process.env.GOOGLE_OAUTH_REDIRECT_URI ??
        `${origin}/api/google/calendar/callback`
      );
    case "gmail":
      return (
        process.env.GOOGLE_GMAIL_REDIRECT_URI ??
        `${origin}/api/google/gmail/callback`
      );
    case "youtube":
      return (
        process.env.GOOGLE_YOUTUBE_REDIRECT_URI ??
        `${origin}/api/google/youtube/callback`
      );
  }
}

export function getTokenEncryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Missing GOOGLE_TOKEN_ENCRYPTION_KEY");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)",
    );
  }
  return buf;
}

export function getYoutubeTasteCacheTtlHours(): number {
  const raw = process.env.YOUTUBE_TASTE_CACHE_TTL_HOURS;
  if (!raw) return 24;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}
