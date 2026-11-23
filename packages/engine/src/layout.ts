/**
 * Assigns consecutive tables from 1. Before placing an even-sized race on an
 * even table (which would split a referee station), the next odd-sized race
 * is moved in front of it, if there is one.
 */
export function layoutTables<T>(races: T[][]): { race: T[]; tables: number[] }[] {
  const queue = [...races];
  const out: { race: T[]; tables: number[] }[] = [];
  let next = 1;
  while (queue.length) {
    if (queue[0]!.length % 2 === 0 && next % 2 === 0) {
      const odd = queue.findIndex((r) => r.length % 2 === 1);
      if (odd > 0) queue.unshift(queue.splice(odd, 1)[0]!);
    }
    const race = queue.shift()!;
    out.push({ race, tables: race.map((_, i) => next + i) });
    next += race.length;
  }
  return out;
}
