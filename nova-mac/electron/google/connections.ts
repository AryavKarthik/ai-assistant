import { shell, type BrowserWindow } from "electron";
import crypto from "node:crypto";
import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import { buildServiceAuthUrl, exchangeCodeForTokens } from "./oauth";
import type { GoogleService } from "./scopes";
import type { GoogleConnectionStatus } from "@shared/types";
import { IpcChannel } from "@shared/types";

// code_verifier keyed by state param for PKCE
const pendingStates = new Map<string, { service: GoogleService }>();

export async function startOAuthFlow(service: GoogleService): Promise<void> {
  const state = crypto.randomUUID();
  pendingStates.set(state, { service });
  // PKCE not needed since googleapis handles it internally for desktop flows;
  // state param provides CSRF protection
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

  const tokens = await exchangeCodeForTokens(code, pending.service);
  const supabase = getSupabase();
  const userId = await getUserId();

  const { error } = await supabase.from("google_oauth_tokens").upsert(
    {
      user_id: userId,
      service: pending.service,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    },
    { onConflict: "user_id,service" },
  );
  if (error) throw error;

  // Notify renderer to refresh status
  appWin?.webContents.send(IpcChannel.ConnectionsCallback);
}

export async function getConnectionsStatus(): Promise<GoogleConnectionStatus> {
  const supabase = getSupabase();
  const userId = await getUserId();

  const { data } = await supabase
    .from("google_oauth_tokens")
    .select("service, access_token")
    .eq("user_id", userId);

  const connected = new Set((data ?? []).map((r) => r.service));
  return {
    calendar: { connected: connected.has("calendar"), email: null },
    gmail: { connected: connected.has("gmail"), email: null },
    youtube: { connected: connected.has("youtube"), email: null },
  };
}

export async function disconnectService(service: GoogleService): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  await supabase
    .from("google_oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("service", service);
}
