import { useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from './db';
import { pull, push, supabaseRemote, type Remote } from './sync';

/**
 * Runs sync in the background: on start, after local writes (debounced), when
 * the connection returns and when the app comes back to the foreground.
 * Exposes a small status for the UI. Never logs row contents.
 */

export interface SyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  error: string | null;
}

let state: SyncState = { status: 'idle', lastSyncedAt: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let remote: Remote | null = null;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function isNetworkError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return !navigator.onLine || e instanceof TypeError || /fetch|network|timeout|abort/i.test(msg) || (e as Error)?.name === 'TimeoutError';
}

export function syncNow(): Promise<void> {
  if (!remote) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const r = remote;
  running = (async () => {
    do {
      again = false;
      if (!navigator.onLine) {
        // Don't fire requests that can only hang; the 'online' event restarts us.
        set({ status: 'offline', error: null });
        break;
      }
      set({ status: 'syncing' });
      try {
        await push(db, r);
        await pull(db, r);
        set({ status: 'idle', lastSyncedAt: new Date().toISOString(), error: null });
      } catch (e) {
        if (isNetworkError(e)) set({ status: 'offline', error: null });
        else set({ status: 'error', error: (e as Error)?.message ?? 'Sync failed' });
        // `again` stays set if something (e.g. reconnecting) requested a sync meanwhile.
      }
    } while (again && remote === r);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Call after local writes. */
export function requestSync(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), 300);
}

const onOnline = () => void syncNow();
const onVisible = () => {
  if (document.visibilityState === 'visible') void syncNow();
};

export function startSync(sb: SupabaseClient, userId: string): void {
  remote = supabaseRemote(sb, userId);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  void syncNow();
}

export function stopSync(): void {
  remote = null;
  clearTimeout(timer);
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  set({ status: 'idle', lastSyncedAt: null, error: null });
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
