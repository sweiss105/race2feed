import { useState } from 'preact/hooks';
import { Button } from '../../ui/Button';

type Role = 'admin' | 'control';

export function Login({ login, onSignedIn }: {
  login(role: Role, password: string): Promise<{ ok: true } | { ok: false; status: number }>;
  onSignedIn(): void;
}) {
  const [role, setRole] = useState<Role>('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(role, password);
      if (r.ok) onSignedIn();
      else setError(r.status === 429 ? 'Too many attempts. Wait five minutes and try again.' : 'Wrong password');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="center-page">
      <form class="card login" onSubmit={submit}>
        <h1 class="title-1">Race control</h1>
        <div class="segmented" role="radiogroup" aria-label="Sign in as">
          {(['admin', 'control'] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r ? 'true' : 'false'} aria-selected={role === r ? 'true' : 'false'} onClick={() => setRole(r)}>
              {r === 'admin' ? 'Admin' : 'Race control'}
            </button>
          ))}
        </div>
        <label class="field">
          <span class="footnote secondary">Password</span>
          <input class="input" type="password" autocomplete="current-password" value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </label>
        {error && <p class="callout" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <Button type="submit" busy={busy} disabled={!password}>Sign in</Button>
      </form>
    </div>
  );
}
