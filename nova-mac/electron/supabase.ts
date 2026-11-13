import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });
  return client;
}
