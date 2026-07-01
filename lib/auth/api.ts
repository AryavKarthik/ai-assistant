import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UnauthorizedError,
  requireSessionUser,
  type SessionUser,
} from "@/lib/auth/session";
import { runWithSupabaseAsync } from "@/lib/supabase/context";
import { createAuthServerClient } from "@/lib/supabase/server";

export interface AuthContext {
  user: SessionUser;
  supabase: SupabaseClient;
}

export async function withAuth<T>(
  handler: (ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const supabase = await createAuthServerClient();
  const user = await requireSessionUser(supabase);
  return runWithSupabaseAsync(supabase, () => handler({ user, supabase }));
}

export async function withAuthRoute(
  handler: (ctx: AuthContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await withAuth(handler);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}

export async function authJson<T>(
  handler: (ctx: AuthContext) => Promise<T>,
  options?: { status?: number },
): Promise<NextResponse> {
  try {
    const data = await withAuth(handler);
    return NextResponse.json(data, { status: options?.status ?? 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("API error:", error);
    const message =
      error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
