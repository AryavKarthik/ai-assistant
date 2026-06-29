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
  // url looks like nova://auth-callback#access_token=...&refresh_token=...
  const hash = url.split("#")[1] ?? "";
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return;
  const { error } = await getSupabase().auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  saveSession({ access_token, refresh_token });
  emit(IpcChannel.AuthChanged, await getAuthState());
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
