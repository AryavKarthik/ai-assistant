import {
  getGoogleTokenRow,
  isGoogleServiceConnected,
  updateStoredRefreshToken,
} from "./db-tokens";
import { decryptToken } from "./crypto";
import { createOAuth2Client } from "./oauth";
import { GOOGLE_AUTH_EXPIRED } from "./errors";
import type { GoogleService } from "./scopes";

type OAuth2Client = ReturnType<typeof createOAuth2Client>;

// One authenticated client is cached per user and reused until its access
// token nears expiry. Without this, EVERY calendar/gmail/youtube call (the
// 30s proactive scheduler tick, preRetrieveContext, and each tool call) did
// its own refresh-token grant against Google. Google now rotates refresh
// tokens on refresh, so two concurrent grants with the same token race and
// the loser gets `invalid_grant` — surfacing to the user as "calendar's not
// linked" even though the stored token is perfectly valid.
interface CachedAuth {
  oauth2: OAuth2Client;
  /** The refresh token the cached client was minted from (kept in sync when
   *  Google rotates it, so the row-vs-cache comparison below stays true). */
  refreshToken: string;
}

const authCache = new Map<string, CachedAuth>();
/** Single-flight: concurrent callers (scheduler tick + chat turn) share one
 *  mint instead of issuing racing refresh grants. */
const inflightMint = new Map<string, Promise<CachedAuth>>();

const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

function isInvalidGrant(err: unknown): boolean {
  const e = err as {
    message?: string;
    response?: { data?: { error?: string } };
  } | null;
  return (
    e?.response?.data?.error === "invalid_grant" ||
    /invalid_grant/i.test(e?.message ?? "")
  );
}

function accessTokenStillValid(oauth2: OAuth2Client): boolean {
  const { access_token, expiry_date } = oauth2.credentials;
  return Boolean(
    access_token && expiry_date && Date.now() < expiry_date - EXPIRY_MARGIN_MS,
  );
}

async function mintClient(
  userId: string,
  service: GoogleService,
  refreshToken: string,
  isRetryAfterReread = false,
): Promise<CachedAuth> {
  const oauth2 = createOAuth2Client(service);
  oauth2.setCredentials({ refresh_token: refreshToken });

  const entry: CachedAuth = { oauth2, refreshToken };

  oauth2.on("tokens", async (tokens) => {
    if (tokens.refresh_token) {
      // Google rotated the refresh token — persist it and keep the cache
      // entry's notion of "current token" in sync so the next call still
      // sees the cache as fresh.
      entry.refreshToken = tokens.refresh_token;
      try {
        await updateStoredRefreshToken(userId, tokens.refresh_token);
      } catch (err) {
        console.error("[google] failed to persist rotated refresh token:", err);
      }
    }
  });

  try {
    // Refresh eagerly so failures are caught here (with retry) instead of
    // surfacing from deep inside a calendar/gmail API call.
    await oauth2.getAccessToken();
  } catch (err) {
    if (isInvalidGrant(err) && !isRetryAfterReread) {
      // Another consumer (the web app, a previous process) may have
      // persisted a rotated token after we read the row — re-read once and
      // retry with the newer token before declaring the grant dead.
      const fresh = await getGoogleTokenRow(userId);
      const freshToken = fresh?.encrypted_refresh
        ? decryptToken(fresh.encrypted_refresh)
        : null;
      if (freshToken && freshToken !== refreshToken) {
        return mintClient(userId, service, freshToken, true);
      }
    }
    if (isInvalidGrant(err)) {
      throw new Error(GOOGLE_AUTH_EXPIRED);
    }
    throw err;
  }

  authCache.set(userId, entry);
  return entry;
}

export async function getAuthenticatedOAuth2(
  userId: string,
  service: GoogleService,
) {
  const row = await getGoogleTokenRow(userId);
  if (!row?.encrypted_refresh || !isGoogleServiceConnected(row, service)) {
    return null;
  }

  const refreshToken = decryptToken(row.encrypted_refresh);

  const cached = authCache.get(userId);
  if (
    cached &&
    cached.refreshToken === refreshToken &&
    accessTokenStillValid(cached.oauth2)
  ) {
    return cached.oauth2;
  }

  const inflight = inflightMint.get(userId);
  if (inflight) {
    return (await inflight).oauth2;
  }

  const mint = mintClient(userId, service, refreshToken).finally(() => {
    inflightMint.delete(userId);
  });
  inflightMint.set(userId, mint);
  return (await mint).oauth2;
}

/** Test-only: clear cached clients and in-flight mints. */
export function resetAuthClientCache(): void {
  authCache.clear();
  inflightMint.clear();
}
