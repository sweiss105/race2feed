import fixture from '../../../engine/test/fixtures/previous-event.json';
import { handleSetup } from '../../src/core/setup';
import type { LiveEvent } from '../../src/core/model';
import { admin, blank, ctx, ok } from './helpers';

export { fixture };

const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The previous event's 50 teams, groups and tables, with suggested brackets; setup locked. */
export function previousEvent(): LiveEvent {
  const csv = ['team,category', ...fixture.teams.map((t) => `${quote(t.name)},${quote(t.category)}`)].join('\n');
  let e = ok(handleSetup(blank(fixture.tableCount), { type: 'importTeams', csv }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
  const idOf = new Map(e.setup.teams.map((t) => [t.name, t.id]));
  const groups = ['A', 'B'].map((g) => ({
    id: g,
    teamIds: fixture.teams.filter((t) => t.group === g).sort((a, b) => a.table - b.table).map((t) => idOf.get(t.name)!),
  }));
  const tableOf = Object.fromEntries(fixture.teams.map((t) => [idOf.get(t.name)!, t.table]));
  e = ok(handleSetup(e, { type: 'setGroups', groups, tableOf }, ctx(admin)));
  return ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
}
