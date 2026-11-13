import { BrowserWindow } from "electron";
import { getSupabase } from "./supabase";
import { saveSession, loadSession, clearSession } from "./session-store";
import { IpcChannel, type AuthState } from "@shared/types";
import { resetConversationCache } from "./conversation";
import { resetUserIdCache } from "./memory/client";

function emit(channel: IpcChannel, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

export async function startSignIn(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "nova://auth-callback" },
  });
  if (error) throw error;
}

/** Email + password sign-in — the normal path, no deep link involved. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const e = email.trim();
  if (!e || !password) return { ok: false, error: "Enter your email and password." };
  const { data, error } = await getSupabase().auth.signInWithPassword({ email: e, password });
  if (error) return { ok: false, error: error.message };
  if (data.session) {
    saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    emit(IpcChannel.AuthChanged, await getAuthState());
    return { ok: true };
  }
  return { ok: false, error: "No session returned." };
}

// Password chosen on the "first time / forgot password" form, held in memory
// only until the magic link proves the user owns the email. It is applied with
// the user's OWN session (auth.updateUser) — never with a service-role key,
// which would let anyone at the keyboard reset any account's password.
let pendingPassword: { email: string; password: string; expiresAt: number } | null = null;
const PENDING_PASSWORD_TTL_MS = 30 * 60 * 1000;

/**
 * First-time setup / forgotten password. Sends a magic link to the email; the
 * chosen password is set once that link is opened (handleAuthCallback), so
 * only the inbox owner can set or change it.
 */
export async function setPasswordAndSignIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
  const e = email.trim();
  if (!e) return { ok: false, error: "Enter your email." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  try {
    await startSignIn(e);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't send the sign-in link." };
  }
  pendingPassword = { email: e.toLowerCase(), password, expiresAt: Date.now() + PENDING_PASSWORD_TTL_MS };
  return { ok: true, pending: true };
}

/** Applies a pending password to the account that just signed in, if it matches. */
async function applyPendingPassword(sessionEmail: string | undefined): Promise<void> {
  const pending = pendingPassword;
  pendingPassword = null;
  if (!pending || Date.now() > pending.expiresAt) return;
  if (!sessionEmail || sessionEmail.toLowerCase() !== pending.email) return;
  const { error } = await getSupabase().auth.updateUser({ password: pending.password });
  if (error) console.error("[nova] setting password after magic link failed:", error.message);
}

export async function handleAuthCallback(url: string): Promise<void> {
  console.log("[nova] auth callback url:", url);
  // Supabase can deliver tokens as hash (#access_token=...) or query param (?code=...)
  const hashPart = url.split("#")[1] ?? "";
  const queryPart = url.split("?")[1]?.split("#")[0] ?? "";
  const hashParams = new URLSearchParams(hashPart);
  const queryParams = new URLSearchParams(queryPart);

  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  const code = queryParams.get("code");

  if (access_token && refresh_token) {
    const { data, error } = await getSupabase().auth.setSession({ access_token, refresh_token });
    if (error) { console.error("[nova] setSession error:", error); throw error; }
    saveSession({ access_token, refresh_token });
    await applyPendingPassword(data.user?.email);
    emit(IpcChannel.AuthChanged, await getAuthState());
    return;
  }

  if (code) {
    const { data, error } = await getSupabase().auth.exchangeCodeForSession(code);
    if (error) { console.error("[nova] exchangeCode error:", error); throw error; }
    if (data.session) {
      saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      await applyPendingPassword(data.user?.email);
      emit(IpcChannel.AuthChanged, await getAuthState());
    }
    return;
  }

  console.warn("[nova] auth callback: no tokens or code found in url");
}

/**
 * Manual login fallback for dev: the user pastes whatever the browser showed
 * after clicking the magic link — the full `nova://auth-callback#...` URL, or
 * just the `#access_token=...&refresh_token=...` fragment, or the bare
 * `?code=...`. We normalize it and run it through the same callback handler.
 * Returns a friendly error string instead of throwing so the UI can show it.
 */
export async function pasteAuthCallback(input: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Paste the link first." };

  // Accept a raw fragment/query the user copied without the scheme.
  let url = trimmed;
  if (!/^nova:\/\//i.test(url)) {
    if (url.startsWith("#") || url.startsWith("?")) {
      url = `nova://auth-callback${url}`;
    } else if (/access_token=|refresh_token=|[?&]code=/.test(url)) {
      url = `nova://auth-callback#${url.replace(/^[#?]/, "")}`;
    } else {
      return {
        ok: false,
        error: "That doesn't look like a login link. Copy the whole nova://auth-callback… URL from your browser.",
      };
    }
  }

  try {
    await handleAuthCallback(url);
    const state = await getAuthState();
    if (!state.signedIn) {
      return { ok: false, error: "Link didn't contain a valid session. It may have expired — request a new magic link." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign-in failed." };
  }
}

export async function restoreSession(): Promise<void> {
  const stored = loadSession();
  if (!stored) return;
  await getSupabase().auth.setSession(stored);
}

export async function getAuthState(): Promise<AuthState> {
  const { data } = await getSupabase().auth.getUser();
  return { signedIn: !!data.user, email: data.user?.email ?? null };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  clearSession();
  resetConversationCache();
  resetUserIdCache();
  emit(IpcChannel.AuthChanged, { signedIn: false, email: null });
}
