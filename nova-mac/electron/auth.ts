import { BrowserWindow } from "electron";
import { getSupabase } from "./supabase";
import { saveSession, loadSession, clearSession } from "./session-store";
import { IpcChannel, type AuthState } from "@shared/types";

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
  emit(IpcChannel.AuthChanged, { signedIn: false, email: null });
}
