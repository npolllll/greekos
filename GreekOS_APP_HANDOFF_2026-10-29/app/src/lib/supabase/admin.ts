import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.ts';

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it is only used inside narrow server handlers that have
 * already derived the acting user from a verified session and checked authorization.
 */
export function adminClient(): SupabaseClient {
  if (typeof window !== 'undefined') throw new Error('service role client must never run in the browser');
  cached ??= createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-greekos-server': '1' } },
  });
  return cached;
}

/** Page through a query (PostgREST caps responses at max_rows, 1000 by default). */
export async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
