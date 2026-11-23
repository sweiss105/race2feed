export interface Credentials { session?: string; device?: string; apiKey?: string }

export const SESSION_COOKIE = 'r2f_session';
export const DEVICE_COOKIE = 'r2f_device';

function cookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Session or device cookie, or a Bearer API key. */
export function credentials(request: Request): Credentials {
  const c = cookies(request);
  const auth = request.headers.get('authorization') ?? '';
  return {
    ...(c[SESSION_COOKIE] ? { session: c[SESSION_COOKIE] } : {}),
    ...(c[DEVICE_COOKIE] ? { device: c[DEVICE_COOKIE] } : {}),
    ...(auth.startsWith('Bearer ') ? { apiKey: auth.slice(7).trim() } : {}),
  };
}

export const hasCredentials = (c: Credentials) => Boolean(c.session || c.device || c.apiKey);
