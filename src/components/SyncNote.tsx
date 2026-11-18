import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { useSyncState } from '../data/syncController';

/** Quiet, factual note about unsynced changes. Silent when everything is synced. */
export function SyncNote() {
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const { status, error } = useSyncState();
  if (status === 'error') return <p className="sync-note" role="status">Couldn’t sync just now ({error}). Your changes are safe on this device.</p>;
  // Normal syncing is silent; only mention it when changes are actually waiting on a connection.
  if (!pending || status !== 'offline') return null;
  const what = pending === 1 ? '1 change' : `${pending} changes`;
  return <p className="sync-note" role="status">{what} saved on this device; will sync when online.</p>;
}
