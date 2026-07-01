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

export async function handleConnectionsCallback(
  url: string,
  appWin: BrowserWindow | null,
): Promise<void> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (!code || !state) return;

  const pending = pendingStates.get(state);
  if (!pending) return;
  pendingStates.delete(state);

  const { service } = pending;
  const tokens = await exchangeCodeForTokens(code, service);

  const refreshToken = tokens.refresh_token;
  if (!refreshToken) return; // no refresh token means we can't persist a long-lived connection

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

  appWin?.webContents.send(IpcChannel.ConnectionsCallback);
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
