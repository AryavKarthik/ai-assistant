import { getSupabase } from "../supabase";
import { encryptToken, decryptToken } from "./crypto";
import { revokeRefreshToken } from "./oauth";
import type { GoogleService } from "./scopes";
import { hasGmailComposeScope, hasYoutubeReadScope } from "./scopes";

export interface GoogleTokenRow {
  user_id: string;
  encrypted_refresh: string;
  scopes: string[];
  calendar_connected: boolean;
  gmail_connected: boolean;
  youtube_connected: boolean;
  connected_email: string | null;
  connected_at: string;
  gmail_connected_at: string | null;
  youtube_connected_at: string | null;
  updated_at: string;
}

export interface ServiceConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  canSend?: boolean;
  canUse?: boolean;
}

export interface GoogleConnectionStatus {
  calendar: ServiceConnectionStatus;
  gmail: ServiceConnectionStatus;
  youtube: ServiceConnectionStatus;
}

function serviceConnectedField(
  service: GoogleService,
): "calendar_connected" | "gmail_connected" | "youtube_connected" {
  return `${service}_connected` as
    | "calendar_connected"
    | "gmail_connected"
    | "youtube_connected";
}

function serviceConnectedAtField(
  service: GoogleService,
): "connected_at" | "gmail_connected_at" | "youtube_connected_at" {
  if (service === "calendar") return "connected_at";
  return `${service}_connected_at` as
    | "gmail_connected_at"
    | "youtube_connected_at";
}

export function isGoogleServiceConnected(
  row: GoogleTokenRow | null,
  service: GoogleService,
): boolean {
  if (!row) return false;
  return Boolean(row[serviceConnectedField(service)]);
}

export async function getGoogleTokenRow(
  userId: string,
): Promise<GoogleTokenRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function upsertGoogleServiceToken(
  userId: string,
  service: GoogleService,
  refreshToken: string,
  grantedScopes: string[],
  connectedEmail: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const existing = await getGoogleTokenRow(userId);
  const mergedScopes = [...new Set([...(existing?.scopes ?? []), ...grantedScopes])];

  const connectedField = serviceConnectedField(service);
  const connectedAtField = serviceConnectedAtField(service);

  const row: Record<string, unknown> = {
    user_id: userId,
    encrypted_refresh: encryptToken(refreshToken),
    scopes: mergedScopes,
    [connectedField]: true,
    [connectedAtField]: now,
    updated_at: now,
  };

  if (connectedEmail) {
    row.connected_email = connectedEmail;
  }

  const { error } = await supabase
    .from("google_oauth_tokens")
    .upsert(row, { onConflict: "user_id" });

  if (error) throw error;
}

export async function updateStoredRefreshToken(
  userId: string,
  refreshToken: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("google_oauth_tokens")
    .update({
      encrypted_refresh: encryptToken(refreshToken),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw error;
}

export async function deleteGoogleToken(userId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("google_oauth_tokens")
    .delete()
    .eq("user_id", userId);

  if (error) throw error;
}

function rowToServiceStatus(
  row: GoogleTokenRow | null,
  service: GoogleService,
): ServiceConnectionStatus {
  const connectedField = serviceConnectedField(service);
  const connectedAtField = serviceConnectedAtField(service);

  if (!row?.[connectedField]) {
    return { connected: false, email: null, connectedAt: null };
  }

  const status: ServiceConnectionStatus = {
    connected: true,
    email: row.connected_email,
    connectedAt: row[connectedAtField],
  };

  if (service === "gmail") {
    status.canSend = hasGmailComposeScope(row.scopes);
  }

  if (service === "youtube") {
    status.canUse = hasYoutubeReadScope(row.scopes);
  }

  return status;
}

export async function getGoogleConnectionStatus(
  userId: string,
): Promise<GoogleConnectionStatus> {
  const row = await getGoogleTokenRow(userId);
  return {
    calendar: rowToServiceStatus(row, "calendar"),
    gmail: rowToServiceStatus(row, "gmail"),
    youtube: rowToServiceStatus(row, "youtube"),
  };
}

export async function disconnectGoogleService(
  userId: string,
  service: GoogleService,
): Promise<void> {
  const row = await getGoogleTokenRow(userId);
  if (!row) return;

  const connectedField = serviceConnectedField(service);
  if (!row[connectedField]) return;

  const stillConnected = (
    (service !== "calendar" && row.calendar_connected) ||
    (service !== "gmail" && row.gmail_connected) ||
    (service !== "youtube" && row.youtube_connected)
  );

  if (!stillConnected) {
    try {
      const refreshToken = decryptToken(row.encrypted_refresh);
      await revokeRefreshToken(refreshToken);
    } catch (err) {
      console.error("[google] revoke failed (continuing disconnect):", err);
    }
    await deleteGoogleToken(userId);
    return;
  }

  const supabase = getSupabase();
  const connectedAtField = serviceConnectedAtField(service);
  const { error } = await supabase
    .from("google_oauth_tokens")
    .update({
      [connectedField]: false,
      [connectedAtField]: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw error;
}
