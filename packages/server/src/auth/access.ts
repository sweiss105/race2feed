/** Checks the token Cloudflare Access puts in `Cf-Access-Jwt-Assertion` on the requests it lets through. */

export interface AccessOptions {
  /** The Zero Trust team domain, e.g. `team.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's audience tag. */
  aud: string;
  /** Milliseconds since the epoch. */
  now: number;
  /** The team's public keys. Called a second time, once, when the token's `kid` is not among them. */
  fetchKeys(): Promise<JsonWebKey[]>;
}

type Jwk = JsonWebKey & { kid?: unknown };

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

function decodeBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const decodeJson = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(text)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
  return value as Record<string, unknown>;
};

/**
 * The signed-in email and the token's expiry (milliseconds), or null when the token is not a valid
 * RS256 token from this team for this application. Never throws.
 */
export async function verifyAccessJwt(token: string, opts: AccessOptions): Promise<{ email: string; exp: number } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJson(headerPart);
    const claims = decodeJson(payloadPart);
    const signature = decodeBase64Url(signaturePart);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') return null;

    const find = (keys: JsonWebKey[]) => (keys as Jwk[]).find((k) => k.kid === header.kid && k.kty === 'RSA');
    const jwk = find(await opts.fetchKeys()) ?? find(await opts.fetchKeys());
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['verify']);
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!(await crypto.subtle.verify(ALGORITHM, key, signature, signed))) return null;

    if (claims.iss !== `https://${opts.teamDomain}`) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(opts.aud)) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= opts.now) return null;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf * 1000 > opts.now)) return null;
    if (typeof claims.email !== 'string' || claims.email === '') return null;
    return { email: claims.email, exp: claims.exp * 1000 };
  } catch {
    return null;
  }
}

const KEYS_TTL_MS = 60 * 60 * 1000;
/** Per Worker isolate: the team's keys and when they were fetched. */
const keyCache = new Map<string, { keys: JsonWebKey[]; at: number }>();

/**
 * `fetchKeys` for one request: the first call answers from a one-hour in-memory cache of
 * `https://{teamDomain}/cdn-cgi/access/certs`; a second call (the `kid` was unknown) fetches again.
 */
export function accessKeyFetcher(teamDomain: string, now: number): () => Promise<JsonWebKey[]> {
  let calls = 0;
  return async () => {
    const cached = keyCache.get(teamDomain);
    if (calls++ === 0 && cached && now - cached.at < KEYS_TTL_MS) return cached.keys;
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access certs: ${res.status}`);
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error('Access certs: no keys');
    const keys = body.keys as JsonWebKey[];
    keyCache.set(teamDomain, { keys, at: now });
    return keys;
  };
}
