import type { Category, EventInput, SeedingGroup, Team } from './types';

const groupId = (i: number) => String.fromCharCode(65 + i);

/**
 * Fewest groups that fit the tables. Each category is split evenly across
 * groups; leftover teams go one at a time to the currently smallest group.
 */
export function suggestSeedingGroups(
  categories: Category[],
  teams: Team[],
  tableCount: number,
): { groups: SeedingGroup[]; tableOf: Record<string, number> } {
  const g = Math.max(1, Math.ceil(teams.length / tableCount));
  const members: Team[][] = Array.from({ length: g }, () => []);
  const catIndex = new Map(categories.map((c, i) => [c.id, i]));

  for (const category of categories) {
    const own = teams.filter((t) => t.categoryId === category.id).sort((a, b) => a.order - b.order);
    const base = Math.floor(own.length / g);
    let next = 0;
    for (const group of members) group.push(...own.slice(next, (next += base)));
    for (const team of own.slice(next)) {
      const smallest = members.reduce((best, grp, i) => (grp.length < members[best]!.length ? i : best), 0);
      members[smallest]!.push(team);
    }
  }

  const tableOf: Record<string, number> = {};
  const groups = members.map((list, i) => {
    list.sort(
      (a, b) => (catIndex.get(a.categoryId) ?? 0) - (catIndex.get(b.categoryId) ?? 0) || a.order - b.order,
    );
    list.forEach((t, k) => (tableOf[t.id] = k + 1));
    return { id: groupId(i), teamIds: list.map((t) => t.id) };
  });
  return { groups, tableOf };
}

export function validateSeedingGroups(input: EventInput): string[] {
  const errors: string[] = [];
  const name = new Map(input.teams.map((t) => [t.id, t.name || t.id]));
  const seen = new Map<string, number>();
  for (const group of input.groups) {
    const tables = new Map<number, string>();
    for (const id of group.teamIds) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      const table = input.tableOf[id];
      if (table === undefined || !Number.isInteger(table) || table < 1 || table > input.tableCount) {
        errors.push(`${name.get(id)}: table must be 1–${input.tableCount}`);
      } else if (tables.has(table)) {
        errors.push(`Group ${group.id}: table ${table} assigned to both ${tables.get(table)} and ${name.get(id)}`);
      } else {
        tables.set(table, name.get(id) ?? id);
      }
    }
  }
  for (const team of input.teams) {
    const n = seen.get(team.id) ?? 0;
    if (n === 0) errors.push(`${name.get(team.id)} is not in a seeding group`);
    if (n > 1) errors.push(`${name.get(team.id)} is in more than one seeding group`);
  }
  return errors;
}
