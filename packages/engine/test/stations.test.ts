import { describe, it, expect } from 'vitest';
import { stationOfTable, tablesOfStation, stationCount } from '../src/stations';

describe('stations', () => {
  it('maps tables to pairs', () => {
    expect(stationOfTable(1)).toBe(1);
    expect(stationOfTable(4)).toBe(2);
  });
  it('lists a station\'s tables', () => {
    expect(tablesOfStation(13, 26)).toEqual([25, 26]);
    expect(tablesOfStation(13, 25)).toEqual([25]);
  });
  it('counts stations', () => {
    expect(stationCount(25)).toBe(13);
    expect(stationCount(26)).toBe(13);
  });
  it('can give each table its own referee', () => {
    expect(stationOfTable(3, 1)).toBe(3);
    expect(tablesOfStation(3, 26, 1)).toEqual([3]);
    expect(stationCount(25, 1)).toBe(25);
  });
});
