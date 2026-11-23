export interface Me { role: 'admin' | 'control' | 'referee' | 'companion'; label: string; station?: number }

const json = { 'content-type': 'application/json' };

export async function login(role: 'admin' | 'control', password: string): Promise<{ ok: true } | { ok: false; status: number }> {
  const res = await fetch('/api/login', { method: 'POST', headers: json, body: JSON.stringify({ role, password }) });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

export async function me(): Promise<Me | null> {
  const res = await fetch('/api/me');
  return res.ok ? ((await res.json()) as Me) : null;
}

export async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  return res.ok ? ((await res.json()) as T) : null;
}
