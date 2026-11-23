import { describe, it, expect } from 'vitest';
import { nextDelay } from '../../src/lib/backoff';

describe('nextDelay', () => {
  it('waits at least one second', () => {
    expect(nextDelay(0, () => 0)).toBe(1000);
  });
  it('spreads the first retry across 1–2 s instead of piling onto 1 s', () => {
    const delays = Array.from({ length: 2000 }, () => nextDelay(0, Math.random));
    expect(delays.filter((d) => d === 1000).length).toBeLessThan(20);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2000);
  });
  it('grows to at most 31 s', () => {
    expect(nextDelay(10, () => 1)).toBe(31_000);
    for (let i = 0; i < 1000; i++) {
      const d = nextDelay(i % 12, Math.random);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(31_000);
    }
  });
});
