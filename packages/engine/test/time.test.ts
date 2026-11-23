import { describe, it, expect } from 'vitest';
import { parseClockTime, formatMs, hundredths } from '../src/time';

describe('parseClockTime', () => {
  it('parses m:ss', () => {
    expect(parseClockTime('4:05')).toBe(245_000);
    expect(parseClockTime('11:08')).toBe(668_000);
  });
  it('parses m:ss.hh', () => {
    expect(parseClockTime('3:41.20')).toBe(221_200);
  });
  it('rejects malformed input', () => {
    expect(() => parseClockTime('4.05')).toThrow('Invalid time: 4.05');
    expect(() => parseClockTime('4:5')).toThrow();
    expect(() => parseClockTime('4:65')).toThrow();
  });
});

describe('formatMs', () => {
  it('truncates to hundredths', () => {
    expect(formatMs(221_209, 'hundredths')).toBe('3:41.20');
  });
  it('formats whole seconds', () => {
    expect(formatMs(345_000, 'seconds')).toBe('5:45');
  });
});

describe('hundredths', () => {
  it('floors to hundredths of a second', () => {
    expect(hundredths(192_409)).toBe(19_240);
  });
});
