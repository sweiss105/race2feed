/** A referee station covers a fixed pair of adjacent tables (1&2, 3&4, …). */
export function stationOfTable(table: number): number {
  return Math.ceil(table / 2);
}

export function tablesOfStation(station: number, tableCount: number): number[] {
  const first = station * 2 - 1;
  return first + 1 <= tableCount ? [first, first + 1] : [first];
}

export function stationCount(tableCount: number): number {
  return Math.ceil(tableCount / 2);
}
