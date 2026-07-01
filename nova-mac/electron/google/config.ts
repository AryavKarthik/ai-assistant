import type { GoogleService } from "./scopes";

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

export function getRedirectUriForService(_service: GoogleService): string {
  return "nova://connections-callback";
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
