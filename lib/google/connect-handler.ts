import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/auth/api";
import { requireSessionUser } from "@/lib/auth/session";
import { runWithSupabaseAsync } from "@/lib/supabase/context";
import { createAuthServerClient } from "@/lib/supabase/server";
import {
  getGoogleTokenRow,
  upsertGoogleServiceToken,
} from "@/lib/db/google-tokens";
import {
  buildServiceAuthUrl,
  exchangeCodeForTokens,
  getGoogleAccountEmail,
} from "@/lib/google/oauth";
import type { GoogleService } from "@/lib/google/scopes";
import {
  consumeOAuthStateCookie,
  createOAuthState,
  setOAuthStateCookie,
  verifyOAuthState,
} from "@/lib/google/state";

export async function handleGoogleConnect(
  service: GoogleService,
): Promise<NextResponse> {
  return withAuthRoute(async ({ user }) => {
    const state = createOAuthState(user.id);
    await setOAuthStateCookie(state);
    const existingScopes = await getExistingScopesForUser(user.id);
    const url = buildServiceAuthUrl(service, state, existingScopes);
    return NextResponse.redirect(url);
  });
}

export async function handleGoogleOAuthCallback(
  request: Request,
  service: GoogleService,
  onConnected?: (userId: string) => Promise<void>,
): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/connections?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/connections?error=missing_code`);
  }

  try {
    const supabase = await createAuthServerClient();
    const user = await requireSessionUser(supabase);

    const cookieState = await consumeOAuthStateCookie();
    if (
      !cookieState ||
      cookieState !== state ||
      !verifyOAuthState(state, user.id)
    ) {
      return NextResponse.redirect(`${origin}/connections?error=invalid_state`);
    }

    const tokens = await exchangeCodeForTokens(code, service);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${origin}/connections?error=no_refresh_token`,
      );
    }

    const email = tokens.access_token
      ? await getGoogleAccountEmail(tokens.access_token, service)
      : null;

    const scopeRaw = tokens.scope ?? "";
    const grantedScopes = scopeRaw.split(" ").filter(Boolean);

    await runWithSupabaseAsync(supabase, async () => {
      await upsertGoogleServiceToken(
        user.id,
        service,
        tokens.refresh_token!,
        grantedScopes,
        email,
      );
      if (onConnected) {
        await onConnected(user.id);
      }
    });

    return NextResponse.redirect(
      `${origin}/connections?connected=${service}`,
    );
  } catch (error) {
    console.error(`Google ${service} callback error:`, error);
    return NextResponse.redirect(`${origin}/connections?error=callback_failed`);
  }
}

export async function getExistingScopesForUser(
  userId: string,
): Promise<string[]> {
  const row = await getGoogleTokenRow(userId);
  return row?.scopes ?? [];
}
