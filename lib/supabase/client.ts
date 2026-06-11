'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Browser-side Supabase client (anon key only). Singleton so the Realtime
 * websocket and the anonymous auth session are shared across components.
 */
let browserClient: SupabaseClient<Database> | null = null;

export function getBrowserClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!browserClient) {
    browserClient = createClient<Database>(url, key);
  }
  return browserClient;
}

/**
 * Anonymous auth: sign in silently on first load so simulations can be saved
 * per-user immediately. Upgradeable to magic-link later (linkIdentity).
 */
export async function ensureAnonSession(): Promise<string | null> {
  const supabase = getBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('Anonymous sign-in failed:', error.message);
    return null;
  }
  return anon.user?.id ?? null;
}
