import { describe, it, expect } from 'vitest';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../../src/auth/crypto';
import { loginAllowed } from '../../src/auth/ratelimit';

describe('passwords', () => {
  it('verify the right password only', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.iterations).toBe(100_000);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong horse', stored)).toBe(false);
  });
  it('use a fresh salt each time', async () => {
    const [a, b] = await Promise.all([hashPassword('x'), hashPassword('x')]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('tokens', () => {
  it('are 32 random bytes in base64url', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it('hash with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('loginAllowed', () => {
  const now = 10_000_000;
  it('allows four recent failures, blocks five', () => {
    expect(loginAllowed([1, 2, 3, 4].map((i) => now - i * 1000), now)).toBe(true);
    expect(loginAllowed([1, 2, 3, 4, 5].map((i) => now - i * 1000), now)).toBe(false);
  });
  it('forgets failures older than five minutes', () => {
    expect(loginAllowed([1, 2, 3, 4, 5].map((i) => now - 300_000 - i), now)).toBe(true);
  });
});

import { shouldTouch } from '../../src/auth/ratelimit';
describe('shouldTouch', () => {
  it('records last-seen at most once a minute', () => {
    expect(shouldTouch(null, 1_000)).toBe(true);
    expect(shouldTouch(1_000, 60_999)).toBe(false);
    expect(shouldTouch(1_000, 61_000)).toBe(true);
  });
});
