import {
  getGoogleTokenRow,
  isGoogleServiceConnected,
  updateStoredRefreshToken,
} from "@/lib/db/google-tokens";
import { decryptToken } from "@/lib/google/crypto";
import { createOAuth2Client } from "@/lib/google/oauth";
import type { GoogleService } from "@/lib/google/scopes";

export async function getAuthenticatedOAuth2(
  userId: string,
  service: GoogleService,
) {
  const row = await getGoogleTokenRow(userId);
  if (!row?.encrypted_refresh || !isGoogleServiceConnected(row, service)) {
    return null;
  }

  const refreshToken = decryptToken(row.encrypted_refresh);
  const oauth2 = createOAuth2Client(service);
  oauth2.setCredentials({ refresh_token: refreshToken });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.refresh_token) {
      try {
        await updateStoredRefreshToken(userId, tokens.refresh_token);
      } catch (err) {
        console.error("[google] failed to persist rotated refresh token:", err);
      }
    }
  });

  return oauth2;
}
