import { useEffect, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { CONTROL_API, getJson, type ApiBase } from '../../../lib/api';
import { useRunner } from '../runner';
import { Switch } from '../../../ui/Switch';
import { getTheme, setTheme, type Theme } from '../../../lib/theme';
import { Events } from './Events';

interface ApiKey { id: string; label: string; created_at: number; revoked_at: number | null }

export function Settings({ view, api = CONTROL_API }: { view: ControlView | null; api?: ApiBase }) {
  return (
    <>
      <h2 class="title-1">Settings</h2>
      <Events view={view} api={api} />
      {view && <EventSettings view={view} />}
      {view && <PenaltyList key={view.event.id} view={view} />}
      <CompanionKeys api={api} />
      <Appearance />
    </>
  );
}

const THEMES: [Theme, string][] = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];

/** Light or dark console for this browser only; stored locally, never sent to the server. */
function Appearance() {
  const [theme, choose] = useState<Theme>(() => getTheme());
  return (
    <section class="panel card stack" aria-labelledby="appearance">
      <h3 id="appearance" class="headline">Appearance</h3>
      <div class="segmented" role="radiogroup" aria-label="Appearance" style={{ margin: 0, maxWidth: '30rem' }}>
        {THEMES.map(([t, label]) => (
          <button key={t} type="button" role="radio" aria-checked={theme === t ? 'true' : 'false'} aria-selected={theme === t ? 'true' : 'false'}
            onClick={() => { setTheme(t); choose(t); }}>{label}</button>
        ))}
      </div>
      <p class="footnote secondary" style={{ margin: 0 }}>Only changes this browser. Phones, referee devices and the projector are not affected.</p>
    </section>
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
      <Switch checked={view.settings.penaltiesEnabled} label="Time penalties"
        onToggle={(enabled) => runner.run({ type: 'setPenaltiesEnabled', enabled })} />
      <Switch checked={view.settings.rotateReferees ?? false} label="Rotate referees each round"
        onToggle={(rotateReferees) => runner.run({ type: 'setSettings', rotateReferees }, 'setSettings-rotate')} />
      <p class="footnote secondary" style={{ margin: 0 }}>Referees are sent to different tables each round so nobody judges the same team repeatedly. Takes effect from the next round opened.</p>
      {runner.error('setSettings-rotate') && <span class="err">{runner.error('setSettings-rotate')}</span>}
      <NumberSetting label="Referee undo window (seconds)" button="Save undo window" initial={view.settings.undoWindowMs / 1000} keyName="setSettings-undo"
        onSave={(s) => void runner.run({ type: 'setSettings', undoWindowMs: Math.round(s * 1000) }, 'setSettings-undo')} />
      <NumberSetting label="Auto-finish delay (seconds)" button="Save auto-finish delay" initial={(view.settings.autoFinishMs ?? 30_000) / 1000} keyName="setSettings-autofinish"
        onSave={(s) => void runner.run({ type: 'setSettings', autoFinishMs: Math.round(s * 1000) }, 'setSettings-autofinish')} />
      <p class="footnote secondary" style={{ margin: 0 }}>The race finishes by itself this long after the last team has a result. Never shorter than the referee undo window. 0 turns auto-finish off.</p>
      <div class="race-actions">
        <label class="field" style={{ flex: 1, gridAutoFlow: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span class="callout">Bags of food packed</span>
          <input class="input" aria-label="Bags of food packed" placeholder="e.g. 9,816" value={bags}
            onInput={(e) => setBags((e.target as HTMLInputElement).value)} />
        </label>
        <Button kind="secondary" busy={runner.busy('setBagTotal')} onClick={() => void runner.run({ type: 'setBagTotal', text: bags })}>Save bag total</Button>
      </div>
    </section>
  );
}

function CompanionKeys({ api }: { api: ApiBase }) {
  const runner = useRunner();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [label, setLabel] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const load = () => void getJson<ApiKey[]>(api, '/apikeys').then((k) => setKeys(k ?? [])).catch(() => {});
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

interface ReasonRow { id: string; name: string; kind: 'time' | 'dq'; seconds: string }

/** The penalties race control picks from when approving a referee's penalty or adding one. */
function PenaltyList({ view }: { view: ControlView }) {
  const runner = useRunner();
  const toRows = () => view.penaltyReasons.map((r) => ({ id: r.id, name: r.name, kind: r.kind, seconds: String((r.amountMs ?? 0) / 1000) }));
  const [rows, setRows] = useState<ReasonRow[]>(toRows);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  // Follow the server's list (e.g. another admin saved it) until this form has unsaved edits.
  const serverList = JSON.stringify(view.penaltyReasons);
  useEffect(() => { if (!dirty) setRows(toRows()); }, [serverList]);
  const edited = (f: (rs: ReasonRow[]) => ReasonRow[]) => { setSaved(false); setDirty(true); setRows(f); };
  const update = (i: number, patch: Partial<ReasonRow>) => edited((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const ids = new Set(rows.map((r) => r.id));
    let n = rows.length + 1;
    while (ids.has(`reason-${n}`)) n++;
    edited((rs) => [...rs, { id: `reason-${n}`, name: '', kind: 'time', seconds: '5' }]);
  };
  const save = async () => {
    setSaved(false);
    const reasons = rows.map((r) => (r.kind === 'dq'
      ? { id: r.id, name: r.name.trim(), kind: 'dq' as const }
      : { id: r.id, name: r.name.trim(), kind: 'time' as const, amountMs: Math.round(Number(r.seconds) * 1000) }));
    const ack = await runner.run({ type: 'setPenaltyReasons', reasons }, 'setPenaltyReasons');
    setProblems(ack && !ack.ok && Array.isArray(ack.detail) ? (ack.detail as string[]) : []);
    if (ack?.ok) { setSaved(true); setDirty(false); }
  };
  const label = (r: ReasonRow, i: number) => r.name.trim() || `penalty ${i + 1}`;
  return (
    <section class="panel card stack reasons-editor" aria-label="Penalty list">
      <h3 class="headline">Penalty list</h3>
      <p class="footnote secondary" style={{ margin: 0 }}>Referees pick from this list when they explain a penalty; race control picks the final one. Everyone sees the name.</p>
      {rows.map((r, i) => (
        <div class="row" key={r.id}>
          <input class="input" aria-label={`Name for ${label(r, i)}`} placeholder="e.g. False Start" maxLength={60} value={r.name}
            onInput={(e) => update(i, { name: (e.target as HTMLInputElement).value })} />
          <select class="input" aria-label={`Kind for ${label(r, i)}`} value={r.kind} onChange={(e) => update(i, { kind: (e.target as HTMLSelectElement).value as 'time' | 'dq' })}>
            <option value="time">Time</option>
            <option value="dq">DQ</option>
          </select>
          <input class="input" type="number" min={0} step="0.5" aria-label={`Seconds for ${label(r, i)}`} disabled={r.kind === 'dq'}
            value={r.kind === 'dq' ? '' : r.seconds} placeholder={r.kind === 'dq' ? '—' : 'sec'}
            onInput={(e) => update(i, { seconds: (e.target as HTMLInputElement).value })} />
          <Button kind="plain" aria-label={`Remove ${label(r, i)}`} disabled={rows.length === 1}
            onClick={() => edited((rs) => rs.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div class="race-actions">
        <Button kind="secondary" onClick={add}>Add penalty</Button>
        <Button busy={runner.busy('setPenaltyReasons')} onClick={() => void save()}>Save penalty list</Button>
        {saved && <span class="callout" style={{ color: 'var(--success)' }}>Saved.</span>}
      </div>
      {runner.error('setPenaltyReasons') && <p class="err">{runner.error('setPenaltyReasons')}</p>}
      {problems.length > 0 && <ul class="err">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </section>
  );
}
