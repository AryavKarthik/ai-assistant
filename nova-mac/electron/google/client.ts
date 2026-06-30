import { google } from "googleapis";
import { getAuthenticatedOAuth2 } from "./auth-client";

export async function getCalendarClient(userId: string) {
  const auth = await getAuthenticatedOAuth2(userId, "calendar");
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}

export async function getGmailClient(userId: string) {
  const auth = await getAuthenticatedOAuth2(userId, "gmail");
  if (!auth) return null;
  return google.gmail({ version: "v1", auth });
}
