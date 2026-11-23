/** How many adjacent tables one referee covers: a pair (1&2, 3&4, …) or a single table. */
export type TablesPerStation = 1 | 2;

export function stationOfTable(table: number, perStation: TablesPerStation = 2): number {
  return Math.ceil(table / perStation);
}

export function tablesOfStation(station: number, tableCount: number, perStation: TablesPerStation = 2): number[] {
  const first = (station - 1) * perStation + 1;
  return Array.from({ length: perStation }, (_, i) => first + i).filter((t) => t <= tableCount);
}

export function stationCount(tableCount: number, perStation: TablesPerStation = 2): number {
  return Math.ceil(tableCount / perStation);
}
