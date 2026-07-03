import { shell, type BrowserWindow } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import { buildServiceAuthUrl, exchangeCodeForTokens, getGoogleAccountEmail } from "./oauth";
import { encryptToken } from "./crypto";
import type { GoogleService } from "./scopes";
import { mergeScopes } from "./scopes";
import type { GoogleConnectionStatus } from "@shared/types";
import { IpcChannel } from "@shared/types";

const pendingStates = new Map<string, { service: GoogleService }>();

/** Set by main.ts so loopback callbacks can notify the app window. */
let appWinGetter: () => BrowserWindow | null = () => null;
export function setConnectionsAppWindowGetter(getter: () => BrowserWindow | null): void {
  appWinGetter = getter;
}

let activeLoopbackServer: http.Server | null = null;
const LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000;

function loopbackHtml(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh"><div style="text-align:center;max-width:26rem"><h2>${title}</h2><p>${body}</p></div></body>`;
}

/**
 * OAuth via the loopback flow: a one-shot local HTTP server on 127.0.0.1
 * receives Google's redirect. Google refuses custom schemes like nova:// as
 * redirect URIs in the Cloud Console ("not a valid URL"), but Desktop-app
 * OAuth clients accept ANY http://127.0.0.1:<port> redirect with nothing to
 * register — so this needs zero console configuration.
 */
export async function startOAuthFlow(service: GoogleService): Promise<void> {
  // One flow at a time — a stale listener would swallow the new callback.
  activeLoopbackServer?.close();
  activeLoopbackServer = null;

  const state = crypto.randomUUID();
  pendingStates.set(state, { service });

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  activeLoopbackServer = server;

  const timeout = setTimeout(() => {
    server.close();
    if (activeLoopbackServer === server) activeLoopbackServer = null;
    pendingStates.delete(state);
  }, LOOPBACK_TIMEOUT_MS);

  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const ok = !url.searchParams.get("error") && url.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      ok
        ? loopbackHtml("Connected to Nova", "You can close this tab and return to Nova.")
        : loopbackHtml("Connection failed", "Google reported an error — check the Connections tab in Nova for details."),
    );
    clearTimeout(timeout);
    server.close();
    if (activeLoopbackServer === server) activeLoopbackServer = null;
    void processCallbackParams(url.searchParams, appWinGetter(), redirectUri);
  });

  const authUrl = buildServiceAuthUrl(service, state, [], redirectUri);
  await shell.openExternal(authUrl);
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

/** Legacy nova:// deep-link callback path (pre-loopback flows). */
export async function handleConnectionsCallback(
  url: string,
  appWin: BrowserWindow | null,
): Promise<void> {
  return processCallbackParams(new URL(url).searchParams, appWin);
}

async function processCallbackParams(
  params: URLSearchParams,
  appWin: BrowserWindow | null,
  redirectUri?: string,
): Promise<void> {
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

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
    await completeConnection(code, service, redirectUri);
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

async function completeConnection(
  code: string,
  service: GoogleService,
  redirectUri?: string,
): Promise<void> {
  const tokens = await exchangeCodeForTokens(code, service, redirectUri);

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
