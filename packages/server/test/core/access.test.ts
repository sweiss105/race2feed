import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { accessKeyFetcher, verifyAccessJwt } from '../../src/auth/access';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const part = (obj: unknown) => b64url(enc.encode(JSON.stringify(obj)));

const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const now = 1_700_000_000_000;
const nowS = now / 1000;

let signer: CryptoKey;
let otherSigner: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };

async function sign(header: Record<string, unknown>, payload: Record<string, unknown>, key = signer): Promise<string> {
  const data = `${part(header)}.${part(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

const goodClaims = () => ({ iss: 'https://team.cloudflareaccess.com', aud: ['aud-1'], exp: nowS + 60, iat: nowS - 10, email: 'a@b.c' });
const goodHeader = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
const opts = () => ({ teamDomain: 'team.cloudflareaccess.com', aud: 'aud-1', now, fetchKeys: async () => [publicJwk] as JsonWebKey[] });

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  const other = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  signer = pair.privateKey;
  otherSigner = other.privateKey;
  publicJwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid: 'k1', alg: 'RS256', use: 'sig' } as JsonWebKey & { kid: string };
});

describe('verifyAccessJwt', () => {
  it('accepts a valid token and returns the email and the expiry in milliseconds', async () => {
    const token = await sign(goodHeader, goodClaims());
    expect(await verifyAccessJwt(token, opts())).toEqual({ email: 'a@b.c', exp: (nowS + 60) * 1000 });
  });

  it('accepts an audience given as a single string', async () => {
    const token = await sign(goodHeader, { ...goodClaims(), aud: 'aud-1' });
    expect(await verifyAccessJwt(token, opts())).toEqual({ email: 'a@b.c', exp: (nowS + 60) * 1000 });
  });

  const refused: [string, () => Promise<string>][] = [
    ['a token for another application', () => sign(goodHeader, { ...goodClaims(), aud: ['aud-2'] })],
    ['an empty audience', () => sign(goodHeader, { ...goodClaims(), aud: [] })],
    ['another issuer', () => sign(goodHeader, { ...goodClaims(), iss: 'https://evil.cloudflareaccess.com' })],
    ['an expired token', () => sign(goodHeader, { ...goodClaims(), exp: nowS - 1 })],
    ['a token expiring this instant', () => sign(goodHeader, { ...goodClaims(), exp: nowS })],
    ['a token with no expiry', () => sign(goodHeader, { ...goodClaims(), exp: undefined })],
    ['a token not valid yet', () => sign(goodHeader, { ...goodClaims(), nbf: nowS + 30 })],
    ['an unknown kid', () => sign({ ...goodHeader, kid: 'k2' }, goodClaims())],
    ['no kid', () => sign({ alg: 'RS256' }, goodClaims())],
    ['a signature from another key', () => sign(goodHeader, goodClaims(), otherSigner)],
    ['alg none', async () => `${part({ alg: 'none', kid: 'k1' })}.${part(goodClaims())}.`],
    ['alg HS256', async () => {
      const t = await sign(goodHeader, goodClaims());
      return `${part({ alg: 'HS256', kid: 'k1' })}.${t.split('.').slice(1).join('.')}`;
    }],
    ['a changed payload', async () => {
      const t = (await sign(goodHeader, goodClaims())).split('.');
      return `${t[0]}.${part({ ...goodClaims(), email: 'someone@else.c' })}.${t[2]}`;
    }],
    ['a missing email', () => sign(goodHeader, { ...goodClaims(), email: undefined })],
    ['an empty email', () => sign(goodHeader, { ...goodClaims(), email: '' })],
    ['not three parts', async () => (await sign(goodHeader, goodClaims())).split('.').slice(0, 2).join('.')],
    ['four parts', async () => `${await sign(goodHeader, goodClaims())}.x`],
    ['garbage', async () => 'not a token at all'],
    ['garbage in three parts', async () => '!!!.@@@.###'],
    ['an empty string', async () => ''],
  ];
  for (const [name, make] of refused) {
    it(`refuses ${name}`, async () => {
      expect(await verifyAccessJwt(await make(), opts())).toBeNull();
    });
  }

  it('accepts a token whose nbf has passed', async () => {
    const token = await sign(goodHeader, { ...goodClaims(), nbf: nowS - 5 });
    expect(await verifyAccessJwt(token, opts())).not.toBeNull();
  });

  it('is null, not a throw, when the keys cannot be fetched', async () => {
    const token = await sign(goodHeader, goodClaims());
    expect(await verifyAccessJwt(token, { ...opts(), fetchKeys: async () => { throw new Error('down'); } })).toBeNull();
  });

  it('asks for the keys again once when the kid is unknown', async () => {
    const token = await sign(goodHeader, goodClaims());
    const fetchKeys = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([publicJwk]);
    expect(await verifyAccessJwt(token, { ...opts(), fetchKeys })).toEqual({ email: 'a@b.c', exp: (nowS + 60) * 1000 });
    expect(fetchKeys).toHaveBeenCalledTimes(2);

    const never = vi.fn(async () => [] as JsonWebKey[]);
    expect(await verifyAccessJwt(token, { ...opts(), fetchKeys: never })).toBeNull();
    expect(never).toHaveBeenCalledTimes(2);

    const known = vi.fn(async () => [publicJwk] as JsonWebKey[]);
    await verifyAccessJwt(token, { ...opts(), fetchKeys: known });
    expect(known).toHaveBeenCalledTimes(1);
  });

  it('does not fetch keys for a token that cannot be parsed', async () => {
    const fetchKeys = vi.fn(async () => [publicJwk] as JsonWebKey[]);
    expect(await verifyAccessJwt('garbage', { ...opts(), fetchKeys })).toBeNull();
    expect(fetchKeys).not.toHaveBeenCalled();
  });
});

describe('accessKeyFetcher', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the team certs, caches them for an hour, and refetches on the second call of a request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk], public_cert: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const domain = `cache-${crypto.randomUUID()}.cloudflareaccess.com`;
    let clock = now;

    expect(await accessKeyFetcher(domain, clock)()).toEqual([publicJwk]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`https://${domain}/cdn-cgi/access/certs`);

    clock += 59 * 60_000;
    await accessKeyFetcher(domain, clock)();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A kid the cache does not know: verifyAccessJwt calls the same fetcher again, which refetches.
    const perRequest = accessKeyFetcher(domain, clock);
    await perRequest();
    await perRequest();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    clock += 61 * 60_000;
    await accessKeyFetcher(domain, clock)();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws when the certs cannot be fetched, which verifyAccessJwt turns into null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(accessKeyFetcher(`down-${crypto.randomUUID()}.cloudflareaccess.com`, now)()).rejects.toThrow();
  });
});
