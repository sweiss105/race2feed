export interface Me { role: 'admin' | 'referee' | 'companion'; label: string; station?: number }

const json = { 'content-type': 'application/json' };

export async function login(password: string): Promise<{ ok: true } | { ok: false; status: number }> {
  const res = await fetch('/api/login', { method: 'POST', headers: json, body: JSON.stringify({ password }) });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
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

export async function me(): Promise<Me | null> {
  const res = await fetch('/api/me');
  return res.ok ? ((await res.json()) as Me) : null;
}

export async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  return res.ok ? ((await res.json()) as T) : null;
}
