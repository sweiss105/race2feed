/**
 * Assigns consecutive tables from 1, keeping head-to-heads on whole referee
 * stations. Odd-sized races flip station parity, so they are kept in pairs:
 * - before an even-sized race on an even table, the next odd race moves in front;
 * - an odd race on an odd table with no other odd race left moves behind the
 *   remaining even races.
 */
export function layoutTables<T>(races: T[][]): { race: T[]; tables: number[] }[] {
  const queue = [...races];
  const out: { race: T[]; tables: number[] }[] = [];
  let next = 1;
  while (queue.length) {
    const isOdd = (r: T[]) => r.length % 2 === 1;
    if (!isOdd(queue[0]!) && next % 2 === 0) {
      const odd = queue.findIndex(isOdd);
      if (odd > 0) queue.unshift(queue.splice(odd, 1)[0]!);
    } else if (isOdd(queue[0]!) && next % 2 === 1 && queue.filter(isOdd).length === 1) {
      queue.push(queue.shift()!);
      if (!isOdd(queue[0]!)) continue;
    }
    const race = queue.shift()!;
    out.push({ race, tables: race.map((_, i) => next + i) });
    next += race.length;
  }
  return out;
}
