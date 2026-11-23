import { describe, it, expect } from 'vitest';
import { authState } from '../../src/lib/api';

const respond = (status: number) => async () => new Response('{}', { status });

describe('authState', () => {
  it('is signed out only on 401 or 403', async () => {
    expect(await authState(respond(200))).toBe('in');
    expect(await authState(respond(401))).toBe('out');
    expect(await authState(respond(403))).toBe('out');
  });
  it('is unknown on server errors and network failures, so pages keep retrying', async () => {
    expect(await authState(respond(500))).toBe('unknown');
    expect(await authState(respond(503))).toBe('unknown');
    expect(await authState(async () => { throw new TypeError('network'); })).toBe('unknown');
  });
});
