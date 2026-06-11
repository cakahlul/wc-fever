'use client';

import { useEffect } from 'react';
import { ensureAnonSession } from '@/lib/supabase/client';

/** Silent anonymous sign-in on first load so simulations save per-user. */
export function AnonAuth() {
  useEffect(() => {
    ensureAnonSession();
  }, []);
  return null;
}
