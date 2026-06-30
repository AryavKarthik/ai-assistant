import { getSupabase } from "../supabase";

let cachedUserId: string | null = null;

export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user) throw new Error("Not signed in");
  cachedUserId = data.user.id;
  return cachedUserId;
}

export function resetUserIdCache(): void {
  cachedUserId = null;
}
