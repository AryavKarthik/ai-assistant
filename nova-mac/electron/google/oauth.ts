import { google } from "googleapis";
import {
  getGoogleClientId,
  getGoogleClientSecret,
  getRedirectUriForService,
} from "./config";
import type { GoogleService } from "./scopes";
import { mergeScopes } from "./scopes";

export function createOAuth2Client(service: GoogleService = "calendar") {
  return new google.auth.OAuth2(
    getGoogleClientId(),
    getGoogleClientSecret(),
    getRedirectUriForService(service),
  );
}

export function buildServiceAuthUrl(
  service: GoogleService,
  state: string,
  existingScopes: string[] = [],
): string {
  const oauth2 = createOAuth2Client(service);
  const scopes = mergeScopes(existingScopes, service);

  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(
  code: string,
  service: GoogleService,
) {
  const oauth2 = createOAuth2Client(service);
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const oauth2 = createOAuth2Client("calendar");
  await oauth2.revokeToken(refreshToken);
}

export async function getGoogleAccountEmail(
  accessToken: string,
  service: GoogleService = "calendar",
): Promise<string | null> {
  try {
    const oauth2 = createOAuth2Client(service);
    oauth2.setCredentials({ access_token: accessToken });
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const { data } = await oauth2Api.userinfo.get();
    return data.email ?? null;
  } catch {
    return null;
  }
}
