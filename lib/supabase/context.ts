import { AsyncLocalStorage } from "async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

const storage = new AsyncLocalStorage<SupabaseClient>();

export function runWithSupabase<T>(client: SupabaseClient, fn: () => T): T {
  return storage.run(client, fn);
}

export function runWithSupabaseAsync<T>(
  client: SupabaseClient,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(client, fn);
}

export function getRequestSupabase(): SupabaseClient | undefined {
  return storage.getStore();
}
