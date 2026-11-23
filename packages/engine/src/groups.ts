import type { Category, EventInput, SeedingGroup, Team } from './types';

const groupId = (i: number) => String.fromCharCode(65 + i);

/**
 * Fewest groups that fit the tables. Teams are taken in category order, then
 * team order, and each group is filled to the table count before the next one
 * starts, so categories stay together and only the last group is short.
 * Tables are numbered 1..k in that order within each group.
 */
export function suggestSeedingGroups(
  categories: Category[],
  teams: Team[],
  tableCount: number,
): { groups: SeedingGroup[]; tableOf: Record<string, number> } {
  const g = Math.max(1, Math.ceil(teams.length / tableCount));
  const catIndex = new Map(categories.map((c, i) => [c.id, i]));
  const ordered = [...teams].sort(
    (a, b) => (catIndex.get(a.categoryId) ?? 0) - (catIndex.get(b.categoryId) ?? 0) || a.order - b.order,
  );

  const tableOf: Record<string, number> = {};
  const groups = Array.from({ length: g }, (_, i) => {
    const list = ordered.slice(i * tableCount, (i + 1) * tableCount);
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
