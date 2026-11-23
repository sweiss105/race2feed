import { useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { useRunner } from '../runner';
import { Problems } from './Problems';

export function Teams({ view, role }: { view: ControlView; role: string }) {
  const runner = useRunner();
  const admin = role === 'admin';
  const locked = view.setupLocked;
  const category = (id: string) => view.categories.find((c) => c.id === id)?.name ?? id;
  return (
    <>
      <h2 class="title-1">Teams</h2>
      <p class="secondary callout">{view.teams.length} teams in {view.categories.length} categories.{locked ? ' Setup is locked: names can still be fixed.' : ''}</p>
      {admin && !locked && <Import />}
      {admin && !locked && <AddTeam categories={view.categories.map((c) => c.name)} />}
      <section class="panel">
        <table class="table">
          <thead><tr><th>Team</th><th>Category</th><th /></tr></thead>
          <tbody>
            {view.teams.map((t) => (
              <TeamRow key={t.id} id={t.id} name={t.name} category={category(t.categoryId)} canRemove={admin && !locked} busy={runner.busy(`team-${t.id}`)} />
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Import() {
  const runner = useRunner();
  const [csv, setCsv] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const importNow = async () => {
    setProblems([]);
    setDone(null);
    const ack = await runner.run({ type: 'importTeams', csv }, 'importTeams');
    if (!ack) return;
    if (ack.ok) { setDone('Imported.'); setCsv(''); }
    else setProblems(Array.isArray(ack.detail) ? (ack.detail as string[]) : [ack.message ?? 'Import failed.']);
  };
  const readFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) setCsv(await file.text());
  };
  return (
    <section class="panel card stack" aria-label="Import teams">
      <h3 class="headline">Import from CSV</h3>
      <p class="footnote secondary" style={{ margin: 0 }}>Columns: <code>team,category</code>. Categories appear in the order they first appear in the file. Importing replaces the current team list.</p>
      <label class="field">
        <span class="footnote secondary">Paste CSV</span>
        <textarea class="input" rows={6} style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--mono)' }} aria-label="Paste CSV"
          value={csv} onInput={(e) => setCsv((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="race-actions">
        <label class="btn btn-secondary">Choose file…<input type="file" accept=".csv,text/csv" class="visually-hidden" onChange={readFile} /></label>
        <Button busy={runner.busy('importTeams')} disabled={!csv.trim()} onClick={importNow}>Import</Button>
        {done && <span class="callout" style={{ color: 'var(--success)' }}>{done}</span>}
      </div>
      <Problems items={problems} />
    </section>
  );
}

function AddTeam({ categories }: { categories: string[] }) {
  const runner = useRunner();
  const [name, setName] = useState('');
  const [cat, setCat] = useState('');
  return (
    <form class="panel card race-actions" onSubmit={async (e) => {
      e.preventDefault();
      const ack = await runner.run({ type: 'addTeam', name, category: cat }, 'addTeam');
      if (ack?.ok) { setName(''); }
    }}>
      <input class="input" style={{ flex: 2 }} aria-label="New team name" placeholder="Team name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <input class="input" style={{ flex: 1 }} aria-label="Category" placeholder="Category" list="categories" value={cat} onInput={(e) => setCat((e.target as HTMLInputElement).value)} />
      <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <Button type="submit" kind="secondary" busy={runner.busy('addTeam')} disabled={!name.trim() || !cat.trim()}>Add team</Button>
      {runner.error('addTeam') && <span class="err">{runner.error('addTeam')}</span>}
    </form>
  );
}

function TeamRow({ id, name, category, canRemove, busy }: { id: string; name: string; category: string; canRemove: boolean; busy: boolean }) {
  const runner = useRunner();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const key = `team-${id}`;
  return (
    <tr>
      <td>
        {editing ? (
          <form style={{ display: 'flex', gap: 'var(--space-2)' }} onSubmit={async (e) => {
            e.preventDefault();
            const ack = await runner.run({ type: 'renameTeam', teamId: id, name: value }, key);
            if (ack?.ok) setEditing(false);
          }}>
            <input class="input" aria-label={`New name for ${name}`} value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
            <Button type="submit" kind="primary" busy={busy}>Save</Button>
            <Button kind="plain" onClick={() => { setEditing(false); setValue(name); }}>Cancel</Button>
          </form>
        ) : <span class="headline">{name}</span>}
        {runner.error(key) && <div class="err">{runner.error(key)}</div>}
      </td>
      <td class="secondary">{category}</td>
      <td><div class="actions">
        {!editing && <Button kind="secondary" aria-label={`Rename ${name}`} onClick={() => { setValue(name); setEditing(true); }}>Rename</Button>}
        {canRemove && <Button kind="destructive" aria-label={`Remove ${name}`} busy={busy} onClick={() => void runner.run({ type: 'removeTeam', teamId: id }, key)}>Remove</Button>}
      </div></td>
    </tr>
  );
}
