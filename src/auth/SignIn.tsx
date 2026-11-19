import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(navigator.onLine ? 'That email and password didn’t match.' : 'You’re offline. Signing in needs a connection the first time.');
  };

  return (
    <main className="signin">
      <h1 className="wordmark">Pilot</h1>
      <p className="muted">A private place to notice how you are.</p>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <main className="signin">
      <h1 className="wordmark">Pilot</h1>
      <p>Pilot isn’t connected to a database yet.</p>
      <p className="muted">
        Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase project URL and publishable key, then restart the dev server. See the README.
      </p>
    </main>
  );
}
