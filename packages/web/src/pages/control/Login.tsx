import { useState } from 'preact/hooks';
import { Button } from '../../ui/Button';

export function Login({ login, onSignedIn }: {
  login(password: string): Promise<{ ok: true } | { ok: false; status: number }>;
  onSignedIn(): void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(password);
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
