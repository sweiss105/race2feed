import { describe, it, expect } from 'vitest';
import { nextDelay } from '../../src/lib/backoff';

describe('nextDelay', () => {
  it('starts at one second and never goes lower', () => {
    expect(nextDelay(0, () => 0)).toBe(1000);
  });
  it('caps before jitter, so the longest wait is 45 s', () => {
    expect(nextDelay(10, () => 1)).toBe(45_000);
  });
  it('always stays between 1 s and 45 s', () => {
    for (let i = 0; i < 1000; i++) {
      const d = nextDelay(i % 12, Math.random);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(45_000);
    }
  });
});
