import { shell, type BrowserWindow } from "electron";
import crypto from "node:crypto";
import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import { buildServiceAuthUrl, exchangeCodeForTokens, getGoogleAccountEmail } from "./oauth";
import { encryptToken } from "./crypto";
import type { GoogleService } from "./scopes";
import { mergeScopes } from "./scopes";
import type { GoogleConnectionStatus } from "@shared/types";
import { IpcChannel } from "@shared/types";

const pendingStates = new Map<string, { service: GoogleService }>();

export async function startOAuthFlow(service: GoogleService): Promise<void> {
  const state = crypto.randomUUID();
  pendingStates.set(state, { service });
  const url = buildServiceAuthUrl(service, state);
  await shell.openExternal(url);
}

const UNVERIFIED_APP_HINT =
  "Google is blocking sign-in because the OAuth app is unverified. Fix in " +
  "console.cloud.google.com → APIs & Services → OAuth consent screen: either " +
  "add your Google account under Test users (Audience section), or set " +
  "Publishing status to In production. Also confirm the Gmail API and Google " +
  "Calendar API are enabled under APIs & Services → Library.";

function notify(
  appWin: BrowserWindow | null,
  payload: import("@shared/types").ConnectionsCallbackPayload,
): void {
  if (!payload.ok) console.error("[connections] OAuth callback failed:", payload.error);
  appWin?.webContents.send(IpcChannel.ConnectionsCallback, payload);
}

export async function handleConnectionsCallback(
  url: string,
  appWin: BrowserWindow | null,
): Promise<void> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  const oauthError = parsed.searchParams.get("error");

  const pending = state ? pendingStates.get(state) : undefined;
  if (state) pendingStates.delete(state);
  const service = pending?.service;

  // Google redirects back with ?error=... when consent fails (access_denied
  // covers both the user cancelling and the unverified-app block). This used
  // to silently `return`, which is why reconnecting "just didn't work".
  if (oauthError) {
    notify(appWin, {
      ok: false,
      service,
      error: `Google returned "${oauthError}" during consent.`,
      hint: oauthError === "access_denied" ? UNVERIFIED_APP_HINT : undefined,
    });
    return;
  }
  if (!code || !state) {
    notify(appWin, { ok: false, service, error: "Callback was missing the authorization code." });
    return;
  }
  if (!pending || !service) {
    notify(appWin, {
      ok: false,
      error: "Unexpected OAuth callback (no pending connection). Try connecting again.",
    });
    return;
  }

  try {
    await completeConnection(code, service);
    notify(appWin, { ok: true, service });
  } catch (err) {
    notify(appWin, {
      ok: false,
      service,
      error: err instanceof Error ? err.message : "Connection failed",
      hint: /access_denied|verification|unverified/i.test(String(err))
        ? UNVERIFIED_APP_HINT
        : undefined,
    });
  }
}

async function completeConnection(code: string, service: GoogleService): Promise<void> {
  const tokens = await exchangeCodeForTokens(code, service);

  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Remove Nova's access at " +
        "myaccount.google.com/permissions, then connect again.",
    );
  }

  const supabase = getSupabase();
  const userId = await getUserId();

  // Read existing row to merge scopes
  const { data: existing } = await supabase
    .from("google_oauth_tokens")
    .select("scopes")
    .eq("user_id", userId)
    .maybeSingle();

  const mergedScopes = mergeScopes(existing?.scopes ?? [], service);

  const connectedEmail = await getGoogleAccountEmail(tokens.access_token ?? "", service);

  const connectedField = `${service}_connected` as
    | "calendar_connected"
    | "gmail_connected"
    | "youtube_connected";

  const row: Record<string, unknown> = {
    user_id: userId,
    encrypted_refresh: encryptToken(refreshToken),
    scopes: mergedScopes,
    [connectedField]: true,
    updated_at: new Date().toISOString(),
  };
  if (connectedEmail) row.connected_email = connectedEmail;

  const { error } = await supabase
    .from("google_oauth_tokens")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

export async function getConnectionsStatus(): Promise<GoogleConnectionStatus> {
  const supabase = getSupabase();
  const userId = await getUserId();

  const { data } = await supabase
    .from("google_oauth_tokens")
    .select("calendar_connected, gmail_connected, youtube_connected, connected_email")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    calendar: { connected: data?.calendar_connected ?? false, email: data?.connected_email ?? null },
    gmail: { connected: data?.gmail_connected ?? false, email: data?.connected_email ?? null },
    youtube: { connected: data?.youtube_connected ?? false, email: data?.connected_email ?? null },
  };
}

export async function disconnectService(service: GoogleService): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();

  const connectedField = `${service}_connected` as
    | "calendar_connected"
    | "gmail_connected"
    | "youtube_connected";

  const { error } = await supabase
    .from("google_oauth_tokens")
    .update({ [connectedField]: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}
