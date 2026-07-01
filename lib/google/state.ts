import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "google_oauth_state";
const MAX_AGE_SEC = 600;

function getStateSecret(): string {
  const secret =
    process.env.GOOGLE_OAUTH_STATE_SECRET ??
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "Missing GOOGLE_OAUTH_STATE_SECRET or GOOGLE_TOKEN_ENCRYPTION_KEY",
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getStateSecret()).update(payload).digest("hex");
}

export function createOAuthState(userId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${userId}:${nonce}`;
  return `${payload}:${sign(payload)}`;
}

export function verifyOAuthState(state: string, userId: string): boolean {
  const parts = state.split(":");
  if (parts.length !== 3) return false;
  const [id, nonce, sig] = parts;
  if (id !== userId) return false;

  const payload = `${id}:${nonce}`;
  const expected = sign(payload);
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function setOAuthStateCookie(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SEC,
    path: "/",
  });
}

export async function consumeOAuthStateCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value ?? null;
  if (value) {
    cookieStore.delete(COOKIE_NAME);
  }
  return value;
}
