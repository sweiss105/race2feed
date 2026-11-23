import { describe, it, expect } from 'vitest';
import { parseTeamsCsv } from '../../src/core/csv';

describe('parseTeamsCsv', () => {
  it('parses quoted names containing commas', () => {
    const r = parseTeamsCsv('team,category\n"Anders, Brooks, & Cole",Corporate\r\nNCYC,Community\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { team: 'Anders, Brooks, & Cole', category: 'Corporate' },
      { team: 'NCYC', category: 'Community' },
    ]);
  });
  it('handles escaped quotes and blank lines', () => {
    const r = parseTeamsCsv('Team,Category\n\n"The ""Fast"" Ones", High School \n');
    expect(r.rows).toEqual([{ team: 'The "Fast" Ones', category: 'High School' }]);
  });
  it('requires the header row', () => {
    expect(parseTeamsCsv('NCYC,Community\n').errors).not.toEqual([]);
  });
  it('reports empty fields with their line number', () => {
    const r = parseTeamsCsv('team,category\nNCYC,\n');
    expect(r.errors.join(' ')).toContain('line 2');
  });
  it('reports duplicate team names', () => {
    expect(parseTeamsCsv('team,category\nNCYC,Community\nncyc,Community\n').errors).not.toEqual([]);
  });
});
