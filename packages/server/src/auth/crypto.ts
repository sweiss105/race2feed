const ITERATIONS = 100_000; // the Workers PBKDF2 maximum
const enc = new TextEncoder();

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export interface StoredPassword { hash: string; salt: string; iterations: number }

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<StoredPassword> {
  return { hash: toHex(await derive(password, salt, ITERATIONS)), salt: toHex(salt), iterations: ITERATIONS };
}

export async function verifyPassword(password: string, stored: StoredPassword): Promise<boolean> {
  const actual = await derive(password, fromHex(stored.salt), stored.iterations);
  const expected = fromHex(stored.hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

/** 32 random bytes, base64url without padding. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}
