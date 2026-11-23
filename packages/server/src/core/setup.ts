import {
  suggestBracketPlan, suggestSeedingGroups, validateBracketPlan, validateSeedingGroups,
  type Category, type EventInput, type Team,
} from '@race2feed/engine';
import { parseTeamsCsv } from './csv';
import { validateReasons } from './reasons';
import { done, fail, type CommandResult, type Ctx, type LiveEvent, type SetupCommand } from './model';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Allowed even when setup is locked: none of these change who races where. */
const ALWAYS_ALLOWED: SetupCommand['type'][] = ['unlockSetup', 'setBagTotal', 'renameTeam', 'setSettings', 'setPenaltyReasons'];

const isInt = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;
const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;

function validGroups(groups: unknown, tableOf: unknown): boolean {
  return Array.isArray(groups)
    && groups.every((g) => g && isStr(g.id) && Array.isArray(g.teamIds) && g.teamIds.every(isStr))
    && !!tableOf && typeof tableOf === 'object' && !Array.isArray(tableOf)
    && Object.values(tableOf).every((t) => isInt(t, 1));
}

function validBrackets(brackets: unknown): boolean {
  return Array.isArray(brackets) && brackets.every((b) => b && isStr(b.id) && isStr(b.categoryId)
    && isInt(b.tierIndex, 0) && typeof b.tierName === 'string' && isInt(b.firstSeed, 1) && isInt(b.size, 1));
}

function withSetup(e: LiveEvent, setup: Partial<EventInput>): LiveEvent {
  return { ...e, setup: { ...e.setup, ...setup } };
}

function categoryFor(categories: Category[], name: string): { categories: Category[]; id: string } {
  const trimmed = name.trim();
  const existing = categories.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return { categories, id: existing.id };
  const base = slug(trimmed) || 'category';
  let id = base;
  for (let n = 2; categories.some((c) => c.id === id); n++) id = `${base}-${n}`;
  return { categories: [...categories, { id, name: trimmed }], id };
}

export function handleSetup(e: LiveEvent, cmd: SetupCommand, ctx: Ctx): CommandResult {
  if (e.setupLocked && !ALWAYS_ALLOWED.includes(cmd.type)) {
    return fail('setup_locked', 'Setup is locked; unlock it before changing teams, groups or brackets.');
  }
  const ok = (event: LiveEvent) => done(event, cmd, ctx);

  switch (cmd.type) {
    case 'importTeams': {
      const { rows, errors } = parseTeamsCsv(cmd.csv);
      if (errors.length) return fail('csv_invalid', 'The CSV has problems.', errors);
      if (!rows.length) return fail('csv_invalid', 'The CSV has no teams.');
      let categories: Category[] = [];
      const teams: Team[] = rows.map((row, order) => {
        const c = categoryFor(categories, row.category);
        categories = c.categories;
        return { id: ctx.newId(), name: row.team, categoryId: c.id, order };
      });
      return ok(withSetup(e, { categories, teams, groups: [], tableOf: {}, brackets: [] }));
    }
    case 'addTeam': {
      const name = cmd.name.trim();
      if (!name || !cmd.category.trim()) return fail('invalid', 'Team name and category are required.');
      if (e.setup.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        return fail('duplicate_team', `A team named "${name}" already exists.`);
      }
      const c = categoryFor(e.setup.categories, cmd.category);
      const order = Math.max(-1, ...e.setup.teams.map((t) => t.order)) + 1;
      return ok(withSetup(e, {
        categories: c.categories,
        teams: [...e.setup.teams, { id: ctx.newId(), name, categoryId: c.id, order }],
      }));
    }
    case 'renameTeam': {
      const name = cmd.name.trim();
      if (!name) return fail('invalid', 'Team name is required.');
      if (!e.setup.teams.some((t) => t.id === cmd.teamId)) return fail('not_found', 'No such team.');
      return ok(withSetup(e, { teams: e.setup.teams.map((t) => (t.id === cmd.teamId ? { ...t, name } : t)) }));
    }
    case 'removeTeam': {
      if (!e.setup.teams.some((t) => t.id === cmd.teamId)) return fail('not_found', 'No such team.');
      const teams = e.setup.teams.filter((t) => t.id !== cmd.teamId);
      const tableOf = { ...e.setup.tableOf };
      delete tableOf[cmd.teamId];
      return ok(withSetup(e, {
        teams,
        categories: e.setup.categories.filter((c) => teams.some((t) => t.categoryId === c.id)),
        groups: e.setup.groups.map((g) => ({ ...g, teamIds: g.teamIds.filter((id) => id !== cmd.teamId) })),
        tableOf,
      }));
    }
    case 'setTableCount':
      if (!Number.isInteger(cmd.tableCount) || cmd.tableCount < 1) return fail('invalid', 'Table count must be at least 1.');
      return ok(withSetup(e, { tableCount: cmd.tableCount }));
    case 'setTablesPerReferee':
      if (cmd.count !== 1 && cmd.count !== 2) return fail('invalid', 'A referee covers 1 or 2 tables.');
      return ok(withSetup(e, { tablesPerStation: cmd.count }));
    case 'suggestSetup': {
      if (!e.setup.teams.length) return fail('no_teams', 'Import teams first.');
      if (e.setup.tableCount < 1) return fail('invalid', 'Table count must be at least 1.');
      const { groups, tableOf } = suggestSeedingGroups(e.setup.categories, e.setup.teams, e.setup.tableCount);
      return ok(withSetup(e, { groups, tableOf, brackets: suggestBracketPlan(e.setup.categories, e.setup.teams) }));
    }
    case 'setGroups':
      if (!validGroups(cmd.groups, cmd.tableOf)) return fail('invalid', 'Groups or tables are malformed.');
      return ok(withSetup(e, { groups: cmd.groups, tableOf: cmd.tableOf }));
    case 'setBrackets':
      if (!validBrackets(cmd.brackets)) return fail('invalid', 'Brackets are malformed.');
      return ok(withSetup(e, { brackets: cmd.brackets }));
    case 'setGrandChampionship':
      return ok(withSetup(e, { grandChampionship: cmd.enabled }));
    case 'lockSetup': {
      if (e.setup.tableCount < 1) return fail('setup_invalid', 'Setup has problems.', ['Table count must be at least 1.']);
      if (!e.setup.teams.length) return fail('setup_invalid', 'Setup has problems.', ['There are no teams.']);
      const errors = [...validateSeedingGroups(e.setup), ...validateBracketPlan(e.setup)];
      if (errors.length) return fail('setup_invalid', 'Setup has problems.', errors);
      return ok({ ...e, setupLocked: true });
    }
    case 'unlockSetup':
      if (e.round.current > 0) return fail('rounds_started', 'Setup cannot be unlocked once racing has started.');
      return ok({ ...e, setupLocked: false });
    case 'setSettings': {
      const settings = { ...e.settings };
      if (cmd.penaltyMs !== undefined) {
        if (!Number.isInteger(cmd.penaltyMs) || cmd.penaltyMs < 0) return fail('invalid', 'Penalty must be a whole number of ms.');
        settings.penaltyMs = cmd.penaltyMs;
      }
      if (cmd.undoWindowMs !== undefined) {
        if (!Number.isInteger(cmd.undoWindowMs) || cmd.undoWindowMs < 0) return fail('invalid', 'Undo window must be a whole number of ms.');
        settings.undoWindowMs = cmd.undoWindowMs;
      }
      return ok({ ...e, settings });
    }
    case 'setBagTotal':
      return ok({ ...e, bagTotal: cmd.text.trim() || null });
    case 'setPenaltyReasons': {
      const problems = validateReasons(cmd.reasons);
      if (problems.length) return fail('invalid', 'The penalty list has problems.', problems);
      return ok({
        ...e,
        penaltyReasons: cmd.reasons.map((r) => ({
          id: r.id, name: r.name.trim(), kind: r.kind, ...(r.kind === 'time' ? { amountMs: r.amountMs } : {}),
        })),
      });
    }
  }
}
