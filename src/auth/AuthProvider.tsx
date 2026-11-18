import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearLocal, db, getMeta, setMeta } from '../data/db';
import { startSync, stopSync, syncNow } from '../data/syncController';

interface AuthValue {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({ session: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const userId = session?.user.id;

  useEffect(() => {
    if (!supabase) return;
    // getSession reads the stored session, so this works offline.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    (async () => {
      // Data on this device belongs to one account. If a different account
      // signs in, wipe the previous account's local copy first.
      const owner = await getMeta<string>(db, 'owner');
      if (owner && owner !== userId) await clearLocal(db);
      await setMeta(db, 'owner', userId);
      if (!cancelled) startSync(supabase!, userId);
    })();
    return () => {
      cancelled = true;
      stopSync();
    };
  }, [userId]);

  const signOut = async () => {
    await syncNow();
    stopSync();
    await supabase?.auth.signOut();
    await clearLocal(db);
  };

  return <AuthContext.Provider value={{ session, loading, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
