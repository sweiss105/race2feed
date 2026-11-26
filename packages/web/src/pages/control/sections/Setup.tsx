import { useEffect, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { useRunner } from '../runner';
import { Switch } from '../../../ui/Switch';
import { Problems } from './Problems';
import { tierOf } from '../../../lib/selectors';
import { bracketSizeHint, NO_BRACKETS } from '../../../lib/formatCopy';
import { TournamentFormat } from './TournamentFormat';

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
      {/* Straight under the buttons that raise them, so they are never below the fold. */}
      {runner.error('suggestSetup') && <p class="err">{runner.error('suggestSetup')}</p>}
      {problems.length > 0 && <div class="panel"><Problems items={problems} /></div>}
      <TournamentFormat view={view} />
      <Tables view={view} />
      <TablesPerReferee view={view} />
      <Brackets view={view} />
      <Groups view={view} />
      <ScreenLinks />
    </>
  );
}

const SCREENS: { name: string; path: string; note: string }[] = [
  { name: 'Participants', path: '/', note: 'The page teams open on their phones.' },
  { name: 'Projector', path: '/projector/', note: 'The big screen in the room.' },
  { name: 'Projector, transparent', path: '/projector/?bg=transparent', note: 'No background, for an OBS browser source over your own image or video.' },
  { name: 'Referee', path: '/ref/', note: 'Referees normally get here by scanning their station code on the Referees tab.' },
  { name: 'Race control', path: '/control/', note: 'This console. Needs the emailed sign-in code.' },
];

/** Every screen's address, so nobody has to remember or retype one. */
export function ScreenLinks({ origin = location.origin }: { origin?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000); }
    catch { setCopied(null); }
  };
  return (
    <section class="panel card stack" aria-labelledby="screen-links">
      <h3 class="title-3" id="screen-links">Screen links</h3>
      <ul class="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {SCREENS.map((s) => {
          const url = `${origin}${s.path}`;
          return (
            <li key={s.path}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ flex: '0 0 12rem' }}>{s.name}</strong>
                <input class="input" style={{ flex: '1 1 18rem' }} readOnly aria-label={`${s.name} link`} value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
                <Button kind="secondary" aria-label={`Copy ${s.name} link`} onClick={() => void copy(url)}>{copied === url ? 'Copied' : 'Copy'}</Button>
              </div>
              <p class="footnote secondary" style={{ margin: 'var(--space-1) 0 0' }}>{s.note}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Brackets({ view }: { view: ControlView }) {
  const runner = useRunner();
  const locked = view.setupLocked;
  const seedingOnly = view.format.brackets === 'none' && view.setup.brackets.length === 0;
  return (
    <section class="panel" aria-label="Brackets">
      <h3 class="headline">Brackets</h3>
      {/* Seeding only races no brackets. Any left in the setup still show, so they can be seen and Suggest clears them. */}
      {seedingOnly && <p class="secondary callout" style={{ margin: 0 }}>{NO_BRACKETS}</p>}
      {!seedingOnly && view.categories.map((c) => (
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
  const knockout = view.format.brackets === 'knockout';
  const maxSize = knockout ? view.setup.tableCount : 7;
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
                <td><input class="input" type="number" min={1} max={maxSize} aria-label={`${name} tier ${i + 1} size`} value={r.size} disabled={locked}
                  style={{ width: '5rem' }} onInput={(e) => update(i, { size: Number((e.target as HTMLInputElement).value) || 1 })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="footnote secondary" style={{ margin: 'var(--space-2) 0 0' }}>{bracketSizeHint(view.format.brackets, view.setup.tableCount)}</p>
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

/** The number of tables at the venue. Changing it clears groups, table assignments and brackets (server). */
export function Tables({ view }: { view: ControlView }) {
  const runner = useRunner();
  const current = view.setup.tableCount;
  const [text, setText] = useState(String(current));
  const [changed, setChanged] = useState(false);
  useEffect(() => setText(String(current)), [current]);
  const n = Number(text);
  const valid = Number.isInteger(n) && n >= 1 && n <= 99;
  const built = view.setup.groups.length > 0 || view.setup.brackets.length > 0;
  const save = async (e: Event) => {
    e.preventDefault();
    if (!valid || n === current) return;
    const ack = await runner.run({ type: 'setTableCount', tableCount: n }, 'setTableCount');
    if (ack?.ok) setChanged(true);
  };
  return (
    <section class="panel card stack" aria-labelledby="tables-count">
      <h3 id="tables-count" class="headline">Tables</h3>
      <form style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }} onSubmit={save}>
        <input class="input" style={{ width: '6rem' }} type="number" min={1} max={99} aria-label="Number of tables" value={text}
          disabled={view.setupLocked} onInput={(e) => { setText((e.target as HTMLInputElement).value); setChanged(false); }} />
        <Button type="submit" kind="secondary" busy={runner.busy('setTableCount')} disabled={view.setupLocked || !valid || n === current}>Save tables</Button>
      </form>
      <p class="footnote secondary" style={{ margin: 0 }}>
        How many packing tables the venue has. This is how many teams can race at once: fewer tables means more rounds, not fewer teams.
        {view.setupLocked ? ' Unlock setup to change this.'
          : built ? ' Changing it clears the seeding groups, table assignments and brackets, because they were built for this number.' : ''}
      </p>
      {!valid && text !== '' && <p class="err">Enter a whole number from 1 to 99.</p>}
      {changed && !built && !view.setupLocked && view.setup.teams.length > 0 && (
        <p class="footnote" role="status" style={{ margin: 0 }}>Tables changed to {current}. Press <strong>Suggest groups and brackets</strong> to rebuild the groups and brackets.</p>
      )}
      {runner.error('setTableCount') && <p class="err">{runner.error('setTableCount')}</p>}
    </section>
  );
}

function TablesPerReferee({ view }: { view: ControlView }) {
  const runner = useRunner();
  const current = view.setup.tablesPerStation ?? 2;
  const [shown, setShown] = useState<1 | 2 | null>(null);
  const value = shown ?? current;
  useEffect(() => setShown(null), [current]);
  const choose = async (count: 1 | 2) => {
    if (count === value) return;
    setShown(count);
    const ack = await runner.run({ type: 'setTablesPerReferee', count });
    if (!ack?.ok) setShown(null);
  };
  return (
    <section class="panel card stack" aria-labelledby="tables-per-referee">
      <h3 id="tables-per-referee" class="headline">Referees</h3>
      <div class="segmented" role="radiogroup" aria-label="Tables per referee" style={{ margin: 0, maxWidth: '30rem' }}>
        {([[2, 'One referee per two tables'], [1, 'One referee per table']] as const).map(([n, label]) => (
          <button key={n} type="button" role="radio" aria-checked={value === n ? 'true' : 'false'} aria-selected={value === n ? 'true' : 'false'}
            disabled={view.setupLocked} onClick={() => void choose(n)}>{label}</button>
        ))}
      </div>
      <p class="footnote secondary" style={{ margin: 0 }}>
        {value === 2 ? 'Each referee times a pair of tables (1 & 2, 3 & 4, …).' : 'Each table has its own referee and device.'}
        {view.setupLocked ? ' Unlock setup to change this.' : ' If referee devices are already paired, pair them again after changing this.'}
      </p>
      {runner.error('setTablesPerReferee') && <p class="err">{runner.error('setTablesPerReferee')}</p>}
    </section>
  );
}
