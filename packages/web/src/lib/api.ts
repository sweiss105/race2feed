export interface Me { role: 'admin' | 'referee' | 'companion'; label: string; station?: number }

/** Where the console's requests go: `/api/control` behind Cloudflare Access, `/api/emergency` with the emergency password. */
export type ApiBase = '/api/control' | '/api/emergency';
export const CONTROL_API: ApiBase = '/api/control';
export const EMERGENCY_API: ApiBase = '/api/emergency';
/** Cloudflare Access's sign-out address. */
export const ACCESS_LOGOUT = '/cdn-cgi/access/logout';

const json = { 'content-type': 'application/json' };

export async function login(api: ApiBase, password: string): Promise<{ ok: true } | { ok: false; status: number }> {
  const res = await fetch(`${api}/login`, { method: 'POST', headers: json, body: JSON.stringify({ password }) });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}

export async function logout(api: ApiBase): Promise<void> {
  await fetch(`${api}/logout`, { method: 'POST' });
}

/**
 * Whether this browser is signed in. Only 401/403 mean "signed out"; a server error or a
 * network failure is "unknown", so pages keep retrying instead of logging people out.
 */
export async function authState(fetchFn: (path: string) => Promise<Response> = (p) => fetch(p)): Promise<'in' | 'out' | 'unknown'> {
  try {
    const res = await fetchFn('/api/me');
    if (res.ok) return 'in';
    return res.status === 401 || res.status === 403 ? 'out' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The console's sign-in state at `api`: signed in (with who), signed out (401/403), Access not set up
 * (503 `access_not_configured`), the route not there (404: emergency sign-in not enabled), or unknown
 * (server error or no network, so the page retries).
 */
export type ConsoleAuth =
  | { state: 'in'; me: Me }
  | { state: 'out' | 'not_configured' | 'not_found' | 'unknown' };

export async function consoleAuth(api: ApiBase, fetchFn: (path: string) => Promise<Response> = (p) => fetch(p)): Promise<ConsoleAuth> {
  try {
    const res = await fetchFn(`${api}/me`);
    if (res.ok) return { state: 'in', me: (await res.json()) as Me };
    if (res.status === 401 || res.status === 403) return { state: 'out' };
    if (res.status === 404) return { state: 'not_found' };
    if (res.status === 503) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === 'access_not_configured') return { state: 'not_configured' };
    }
    return { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

export async function getJson<T>(api: ApiBase, path: string): Promise<T | null> {
  const res = await fetch(`${api}${path}`);
  return res.ok ? ((await res.json()) as T) : null;
}
