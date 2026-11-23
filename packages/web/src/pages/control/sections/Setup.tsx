import { useEffect, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { useRunner } from '../runner';
import { Switch } from '../../../ui/Switch';
import { Problems } from './Problems';
import { tierOf } from '../../../lib/selectors';

type Bracket = ControlView['setup']['brackets'][number];

export function Setup({ view }: { view: ControlView }) {
  const runner = useRunner();
  const [problems, setProblems] = useState<string[]>([]);
  const locked = view.setupLocked;
  const lock = async () => {
    setProblems([]);
    const ack = await runner.run({ type: 'lockSetup' }, 'lockSetup');
    if (ack && !ack.ok) setProblems(Array.isArray(ack.detail) ? (ack.detail as string[]) : [ack.message ?? 'Could not lock.']);
  };
  return (
    <>
      <h2 class="title-1">Setup</h2>
      <p class="secondary callout">
        {view.setup.tableCount} tables · {view.setup.groups.length} seeding group{view.setup.groups.length === 1 ? '' : 's'} · {view.setup.brackets.length} brackets ·{' '}
        {locked ? <strong>Locked</strong> : 'Not locked'}
      </p>
      <div class="race-actions">
        {!locked && <Button kind="secondary" busy={runner.busy('suggestSetup')} onClick={() => void runner.run({ type: 'suggestSetup' })}>Suggest groups and brackets</Button>}
        {!locked && <Button busy={runner.busy('lockSetup')} onClick={lock}>Lock setup</Button>}
        {locked && view.round.current === 0 && <Button kind="secondary" busy={runner.busy('unlockSetup')} onClick={() => void runner.run({ type: 'unlockSetup' })}>Unlock setup</Button>}
        <Switch checked={view.setup.grandChampionship} label="Grand Championship" disabled={locked}
          onToggle={(enabled) => runner.run({ type: 'setGrandChampionship', enabled })} />
      </div>
      {runner.error('suggestSetup') && <p class="err">{runner.error('suggestSetup')}</p>}
      <div class="panel"><Problems items={problems} /></div>
      <Brackets view={view} />
      <Groups view={view} />
    </>
  );
}

function Brackets({ view }: { view: ControlView }) {
  const runner = useRunner();
  const locked = view.setupLocked;
  return (
    <section class="panel" aria-label="Brackets">
      <h3 class="headline">Brackets</h3>
      {view.categories.map((c) => (
        <CategoryBrackets key={c.id} view={view} categoryId={c.id} name={c.name} locked={locked}
          onSave={(own) => void runner.run({ type: 'setBrackets', brackets: [...view.setup.brackets.filter((b) => b.categoryId !== c.id), ...own] }, `brackets-${c.id}`)}
          busy={runner.busy(`brackets-${c.id}`)} error={runner.error(`brackets-${c.id}`)} />
      ))}
    </section>
  );
}

function CategoryBrackets({ view, categoryId, name, locked, onSave, busy, error }: {
  view: ControlView; categoryId: string; name: string; locked: boolean; onSave(b: Bracket[]): void; busy: boolean; error: string | null;
}) {
  const current = view.setup.brackets.filter((b) => b.categoryId === categoryId).sort((a, b) => a.tierIndex - b.tierIndex);
  const [rows, setRows] = useState(current.map((b) => ({ tierName: b.tierName, size: b.size })));
  useEffect(() => setRows(current.map((b) => ({ tierName: b.tierName, size: b.size }))), [JSON.stringify(current)]);
  const teams = view.teams.filter((t) => t.categoryId === categoryId).length;
  const total = rows.reduce((s, r) => s + r.size, 0);
  const build = (): Bracket[] => {
    let seed = 1;
    return rows.map((r, i) => {
      const b = { id: `${categoryId}:${i}`, categoryId, tierIndex: i, tierName: r.tierName, firstSeed: seed, size: r.size };
      seed += r.size;
      return b;
    });
  };
  const update = (i: number, patch: Partial<{ tierName: string; size: number }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div class="card" style={{ marginBottom: 'var(--space-3)' }}>
      <div class="race-head" style={{ marginBottom: 'var(--space-2)' }}>
        <span class="headline">{name}</span>
        <span class={`footnote ${total === teams ? 'secondary' : 'err'}`}>{total} of {teams} teams placed</span>
      </div>
      <table class="table">
        <thead><tr><th>Tier</th><th>Seeds</th><th>Teams</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const first = rows.slice(0, i).reduce((s, x) => s + x.size, 1);
            return (
              <tr key={i} class={tierOf(i)}>
                <td><input class="input" aria-label={`${name} tier ${i + 1} name`} value={r.tierName} disabled={locked}
                  style={{ borderLeft: '0.35rem solid var(--tier)' }} onInput={(e) => update(i, { tierName: (e.target as HTMLInputElement).value })} /></td>
                <td class="tabular secondary">{first}–{first + r.size - 1}</td>
                <td><input class="input" type="number" min={1} max={7} aria-label={`${name} tier ${i + 1} size`} value={r.size} disabled={locked}
                  style={{ width: '5rem' }} onInput={(e) => update(i, { size: Number((e.target as HTMLInputElement).value) || 1 })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!locked && (
        <div class="race-actions" style={{ marginTop: 'var(--space-2)' }}>
          <Button kind="plain" onClick={() => setRows((rs) => [...rs, { tierName: `Tier ${rs.length + 1}`, size: 4 }])}>Add tier</Button>
          {rows.length > 1 && <Button kind="plain" onClick={() => setRows((rs) => rs.slice(0, -1))}>Remove last tier</Button>}
          <Button kind="secondary" busy={busy} onClick={() => onSave(build())}>Save {name} brackets</Button>
          {error && <span class="err">{error}</span>}
        </div>
      )}
    </div>
  );
}

function Groups({ view }: { view: ControlView }) {
  const runner = useRunner();
  const { groups, tableOf } = view.setup;
  const locked = view.setupLocked;
  if (!groups.length) return <p class="panel secondary callout">No seeding groups yet — use Suggest.</p>;
  const groupOf = (teamId: string) => groups.find((g) => g.teamIds.includes(teamId))?.id ?? '';
  const save = (teamId: string, group: string, table: number) => {
    const next = groups.map((g) => ({ ...g, teamIds: g.teamIds.filter((id) => id !== teamId) }));
    next.find((g) => g.id === group)?.teamIds.push(teamId);
    void runner.run({ type: 'setGroups', groups: next, tableOf: { ...tableOf, [teamId]: table } }, 'setGroups');
  };
  const rows = [...view.teams].sort((a, b) => groupOf(a.id).localeCompare(groupOf(b.id)) || (tableOf[a.id] ?? 0) - (tableOf[b.id] ?? 0));
  return (
    <section class="panel" aria-label="Seeding groups">
      <h3 class="headline">Seeding groups and tables</h3>
      {runner.error('setGroups') && <p class="err">{runner.error('setGroups')}</p>}
      <table class="table">
        <thead><tr><th>Team</th><th>Group</th><th>Table</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td><select class="input" aria-label={`Group for ${t.name}`} value={groupOf(t.id)} disabled={locked}
                onChange={(e) => save(t.id, (e.target as HTMLSelectElement).value, tableOf[t.id] ?? 1)}>
                {groups.map((g) => <option key={g.id} value={g.id}>Group {g.id}</option>)}
              </select></td>
              <td><input class="input" type="number" min={1} max={view.setup.tableCount} style={{ width: '5.5rem' }} aria-label={`Table for ${t.name}`}
                value={tableOf[t.id] ?? ''} disabled={locked}
                onChange={(e) => save(t.id, groupOf(t.id), Number((e.target as HTMLInputElement).value))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
