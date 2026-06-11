import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Server-side Supabase clients. NEVER import this module from a client
 * component — the service-role key bypasses RLS entirely.
 *
 * - createServiceClient(): service-role key. Used by crawl jobs and API
 *   routes that write tournament data.
 * - createReadClient(): anon key on the server. Used by React Server
 *   Components for public reads (RLS public-read policies apply).
 */

let serviceClient: SupabaseClient<Database> | null = null;
let readClient: SupabaseClient<Database> | null = null;

export function createServiceClient(): SupabaseClient<Database> {
  if (serviceClient) return serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — required for server jobs.'
    );
  }
  serviceClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

/**
 * Anon-key client for server-rendered reads. Returns null when Supabase env
 * vars are absent so pages can degrade to friendly empty states instead of
 * crashing (e.g. first `npm run dev` before .env.local exists).
 */
export function createReadClient(): SupabaseClient<Database> | null {
  if (readClient) return readClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  readClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return readClient;
}
