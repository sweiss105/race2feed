import { describe, it, expect } from 'vitest';
import { authState, consoleAuth } from '../../src/lib/api';

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

describe('consoleAuth', () => {
  it('asks without following redirects', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    await consoleAuth('/api/control', async (p, init) => { calls.push([p, init]); return new Response('{}', { status: 401 }); });
    expect(calls).toEqual([['/api/control/me', { redirect: 'manual' }]]);
  });

  it('is signed out when Access redirects an expired sign-in to its login page', async () => {
    const redirect = { type: 'opaqueredirect', status: 0, ok: false } as Response;
    expect(await consoleAuth('/api/control', async () => redirect)).toEqual({ state: 'out' });
  });

  it('keeps 401, 503 not configured, 404 and network failures apart', async () => {
    expect(await consoleAuth('/api/control', async () => new Response('{}', { status: 401 }))).toEqual({ state: 'out' });
    expect(await consoleAuth('/api/control', async () => new Response('{"error":"access_not_configured"}', { status: 503 }))).toEqual({ state: 'not_configured' });
    expect(await consoleAuth('/api/emergency', async () => new Response('{}', { status: 404 }))).toEqual({ state: 'not_found' });
    expect(await consoleAuth('/api/control', async () => { throw new TypeError('network'); })).toEqual({ state: 'unknown' });
  });
});
