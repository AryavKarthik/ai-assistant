import { BrowserWindow } from "electron";
import { getSupabase, getServiceSupabase } from "./supabase";
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

/**
 * Sets (or resets) the password for an account and signs in — for first-time
 * setup or a forgotten password. Uses the service role to update the user, so
 * no email round-trip is needed. If the account doesn't exist yet, it's
 * created with the email pre-confirmed.
 */
export async function setPasswordAndSignIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const e = email.trim();
  if (!e) return { ok: false, error: "Enter your email." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

  let admin;
  try {
    admin = getServiceSupabase();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Service role not configured." };
  }

  try {
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) return { ok: false, error: error.message };
    const existing = data.users.find((u) => u.email?.toLowerCase() === e.toLowerCase());
    if (existing) {
      const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (updErr) return { ok: false, error: updErr.message };
    } else {
      const { error: createErr } = await admin.auth.admin.createUser({
        email: e,
        password,
        email_confirm: true,
      });
      if (createErr) return { ok: false, error: createErr.message };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't set password." };
  }

  return signInWithPassword(e, password);
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
    const { error } = await getSupabase().auth.setSession({ access_token, refresh_token });
    if (error) { console.error("[nova] setSession error:", error); throw error; }
    saveSession({ access_token, refresh_token });
    emit(IpcChannel.AuthChanged, await getAuthState());
    return;
  }

  if (code) {
    const { data, error } = await getSupabase().auth.exchangeCodeForSession(code);
    if (error) { console.error("[nova] exchangeCode error:", error); throw error; }
    if (data.session) {
      saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
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
