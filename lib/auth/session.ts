import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAuthServerClient, createServiceClient } from "@/lib/supabase/server";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function getSessionUser(
  supabase?: SupabaseClient,
): Promise<SessionUser | null> {
  const client = supabase ?? (await createAuthServerClient());
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) return null;
  return { id: user.id, email: user.email ?? null };
}

export async function requireSessionUser(
  supabase?: SupabaseClient,
): Promise<SessionUser> {
  const user = await getSessionUser(supabase);
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

// Ensures a public.users row exists for the auth user (id = auth.users.id).
export async function ensureAppUser(user: User): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from("users").upsert(
    { id: user.id },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) throw error;
}
