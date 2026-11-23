import { useEffect, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { getJson } from '../../../lib/api';
import { useRunner } from '../runner';

interface ApiKey { id: string; label: string; created_at: number; revoked_at: number | null }

export function Settings({ view }: { view: ControlView | null }) {
  return (
    <>
      <h2 class="title-1">Settings</h2>
      <Passwords />
      {view && <EventSettings view={view} />}
      <CompanionKeys />
    </>
  );
}

function Passwords() {
  const runner = useRunner();
  const [role, setRole] = useState<'admin' | 'control'>('control');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <form class="panel card stack" onSubmit={async (e) => {
      e.preventDefault();
      setSaved(false);
      const ack = await runner.run({ type: 'setPassword', role, password }, 'setPassword');
      if (ack?.ok) { setPassword(''); setSaved(true); }
    }}>
      <h3 class="headline">Passwords</h3>
      <div class="race-actions">
        <select class="input" style={{ width: 'auto' }} aria-label="Password for" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as 'admin' | 'control')}>
          <option value="control">Race control</option>
          <option value="admin">Admin</option>
        </select>
        <input class="input" style={{ flex: 1 }} type="password" autocomplete="new-password" aria-label="New password" placeholder="At least 8 characters"
          value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        <Button type="submit" busy={runner.busy('setPassword')} disabled={password.length < 8}>Save password</Button>
      </div>
      <p class="footnote secondary" style={{ margin: 0 }}>Changing a password signs out everyone using it.</p>
      {saved && <p class="callout" style={{ color: 'var(--success)', margin: 0 }}>Saved.</p>}
      {runner.error('setPassword') && <p class="err">{runner.error('setPassword')}</p>}
    </form>
  );
}

function NumberSetting({ label, initial, button, onSave, keyName }: { label: string; initial: number; button: string; onSave(v: number): void; keyName: string }) {
  const runner = useRunner();
  const [value, setValue] = useState(String(initial));
  return (
    <div class="race-actions">
      <label class="field" style={{ gridAutoFlow: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span class="callout">{label}</span>
        <input class="input" type="number" min={0} step={1} style={{ width: '6rem' }} aria-label={label} value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
      </label>
      <Button kind="secondary" busy={runner.busy(keyName)} disabled={value === '' || Number.isNaN(Number(value))} onClick={() => onSave(Number(value))}>{button}</Button>
      {runner.error(keyName) && <span class="err">{runner.error(keyName)}</span>}
    </div>
  );
}

function EventSettings({ view }: { view: ControlView }) {
  const runner = useRunner();
  const [bags, setBags] = useState(view.bagTotal ?? '');
  return (
    <section class="panel card stack">
      <h3 class="headline">{view.event.name}</h3>
      <NumberSetting label="Penalty (seconds)" button="Save penalty" initial={view.settings.penaltyMs / 1000} keyName="setSettings-penalty"
        onSave={(s) => void runner.run({ type: 'setSettings', penaltyMs: Math.round(s * 1000) }, 'setSettings-penalty')} />
      <NumberSetting label="Referee undo window (seconds)" button="Save undo window" initial={view.settings.undoWindowMs / 1000} keyName="setSettings-undo"
        onSave={(s) => void runner.run({ type: 'setSettings', undoWindowMs: Math.round(s * 1000) }, 'setSettings-undo')} />
      <div class="race-actions">
        <input class="input" style={{ flex: 1 }} aria-label="Bags of food packed" placeholder="e.g. 9,816" value={bags}
          onInput={(e) => setBags((e.target as HTMLInputElement).value)} />
        <Button kind="secondary" busy={runner.busy('setBagTotal')} onClick={() => void runner.run({ type: 'setBagTotal', text: bags })}>Save bag total</Button>
      </div>
    </section>
  );
}

function CompanionKeys() {
  const runner = useRunner();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [label, setLabel] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const load = () => void getJson<ApiKey[]>('/api/apikeys').then((k) => setKeys(k ?? [])).catch(() => {});
  useEffect(load, []);
  const create = async () => {
    const ack = await runner.run({ type: 'createApiKey', label: label || 'Companion' }, 'createApiKey');
    const reply = ack?.ok ? (ack.reply as { key: string }) : null;
    if (reply) { setRevealed(reply.key); setLabel(''); load(); }
  };
  return (
    <section class="panel card stack">
      <h3 class="headline">Companion keys</h3>
      <p class="footnote secondary" style={{ margin: 0 }}>Bitfocus Companion uses a key to start and finish races. A key is shown only once.</p>
      <div class="race-actions">
        <input class="input" style={{ flex: 1 }} aria-label="Key name" placeholder="e.g. Stream Deck" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
        <Button kind="secondary" busy={runner.busy('createApiKey')} onClick={create}>Create key</Button>
      </div>
      {revealed && (
        <div class="card" style={{ background: 'var(--surface-2)' }}>
          <p class="footnote secondary" style={{ marginTop: 0 }}>Copy this key into Companion now. It won't be shown again.</p>
          <code style={{ wordBreak: 'break-all', fontSize: '1rem' }}>{revealed}</code>
          <div class="race-actions" style={{ marginTop: 'var(--space-3)' }}>
            <Button kind="secondary" onClick={() => void navigator.clipboard?.writeText(revealed).catch(() => {})}>Copy</Button>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </div>
        </div>
      )}
      {keys.length > 0 && (
        <table class="table">
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td class="headline">{k.label}</td>
                <td class="footnote secondary">{new Date(k.created_at).toLocaleDateString()}</td>
                <td>{k.revoked_at ? <span class="secondary">Revoked</span> : (
                  <Button kind="destructive" busy={runner.busy(`key-${k.id}`)} onClick={async () => { await runner.run({ type: 'revokeApiKey', id: k.id }, `key-${k.id}`); load(); }}>Revoke</Button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
