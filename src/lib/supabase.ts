import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isConfigured } from './env';

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * fetch with a timeout. On a weak mobile connection a request can hang
 * indefinitely; without this, sync would stall until the app is restarted.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal && 'any' in AbortSignal ? AbortSignal.any([init.signal, timeout]) : (init?.signal ?? timeout);
  return fetch(input, { ...init, signal });
};

/**
 * Browser Supabase client, using the *publishable* key only. Access control
 * is enforced by Postgres Row Level Security, not by this key being secret.
 */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(env.supabaseUrl, env.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // We sign in with email + password, never via links, so nothing
        // should ever be read from the URL.
        detectSessionInUrl: false,
        storageKey: 'pilot-auth',
      },
      global: { fetch: fetchWithTimeout },
    })
  : null;
