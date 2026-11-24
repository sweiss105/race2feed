import { describe, it, expect, beforeAll, vi } from 'vitest';
import { consoleUser, decodeConsoleIdentity, encodeConsoleIdentity } from '../../src/auth/console';
import type { Env } from '../../src/worker';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const part = (obj: unknown) => b64url(enc.encode(JSON.stringify(obj)));

const now = 1_700_000_000_000;
const nowS = now / 1000;
const TEAM = 'team.cloudflareaccess.com';
let token: string;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'])) as CryptoKeyPair;
  publicJwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid: 'k1' } as JsonWebKey;
  const data = `${part({ alg: 'RS256', kid: 'k1' })}.${part({ iss: `https://${TEAM}`, aud: ['aud-1'], exp: nowS + 60, email: 'a@b.c' })}`;
  token = `${data}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(data))))}`;
});

const env = (vars: Partial<Env>) => vars as Env;
const deps = () => ({ now, fetchKeys: vi.fn(async () => [publicJwk]) });
const req = (url: string, jwt?: string) => new Request(url, jwt ? { headers: { 'cf-access-jwt-assertion': jwt } } : {});
const ACCESS = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'aud-1' };

describe('consoleUser', () => {
  it('refuses everything when the Access settings are missing', async () => {
    for (const vars of [{}, { ACCESS_TEAM_DOMAIN: TEAM }, { ACCESS_AUD: 'aud-1' }, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: 'aud-1' }]) {
      expect(await consoleUser(req('https://r2f.weiss-audio.com/api/control/me', token), env(vars), deps())).toEqual({ error: 'access_not_configured' });
    }
  });

  it('is unauthorized without the Access header', async () => {
    expect(await consoleUser(req('https://r2f.weiss-audio.com/api/control/me'), env(ACCESS), deps())).toEqual({ error: 'unauthorized' });
  });

  it('is unauthorized with a header that does not verify', async () => {
    expect(await consoleUser(req('https://r2f.weiss-audio.com/api/control/me', `${token}x`), env(ACCESS), deps())).toEqual({ error: 'unauthorized' });
    expect(await consoleUser(req('https://r2f.weiss-audio.com/api/control/me', token), env({ ...ACCESS, ACCESS_AUD: 'aud-2' }), deps())).toEqual({ error: 'unauthorized' });
  });

  it('signs in as the email in a valid Access token', async () => {
    expect(await consoleUser(req('https://r2f.weiss-audio.com/api/control/me', token), env(ACCESS), deps()))
      .toEqual({ label: 'a@b.c', exp: (nowS + 60) * 1000 });
  });

  it('uses the dev console user away from the production hostname', async () => {
    const dev = { DEV_CONSOLE_USER: 'dev@example.com' };
    expect(await consoleUser(req('https://localhost/api/control/me'), env(dev), deps())).toEqual({ label: 'dev@example.com', exp: null });
    expect(await consoleUser(req('http://127.0.0.1:8787/api/control/me'), env({ ...dev, ...ACCESS }), deps())).toEqual({ label: 'dev@example.com', exp: null });
  });

  it('never uses the dev console user on the production hostname', async () => {
    const dev = { DEV_CONSOLE_USER: 'dev@example.com' };
    for (const url of ['https://r2f.weiss-audio.com/api/control/me', 'https://R2F.Weiss-Audio.com/api/control/me', 'https://r2f.weiss-audio.com./api/control/me']) {
      expect(await consoleUser(req(url), env({ ...dev, ...ACCESS }), deps()), url).toEqual({ error: 'unauthorized' });
      expect(await consoleUser(req(url), env(dev), deps()), url).toEqual({ error: 'access_not_configured' });
    }
    expect(await consoleUser(req('https://r2f.weiss-audio.com/api/control/me', token), env({ ...dev, ...ACCESS }), deps()))
      .toEqual({ label: 'a@b.c', exp: (nowS + 60) * 1000 });
  });
});

describe('the console identity header', () => {
  it('carries a label with non-Latin-1 characters as a valid header value', () => {
    for (const who of [{ label: 'jörg@例え.jp', exp: 1234 }, { label: 'Race control 名 ö', exp: null }]) {
      const value = encodeConsoleIdentity(who);
      expect(() => new Headers({ 'x-r2f-console': value })).not.toThrow();
      expect(new Headers({ 'x-r2f-console': value }).get('x-r2f-console')).toBe(value);
      expect(decodeConsoleIdentity(value)).toEqual(who);
    }
  });

  it('treats a missing, undecodable or malformed value as absent', () => {
    for (const value of [null, '', '%E0%A4%A', '%', 'not json', encodeURIComponent('[]'), encodeURIComponent('null'),
      encodeURIComponent(JSON.stringify({ label: '', exp: null })), encodeURIComponent(JSON.stringify({ label: 'a', exp: '1' })),
      encodeURIComponent(JSON.stringify({ exp: null }))]) {
      expect(decodeConsoleIdentity(value), String(value)).toBeNull();
    }
  });
});
