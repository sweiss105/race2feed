export interface Credentials { session?: string; device?: string; apiKey?: string }

export const SESSION_COOKIE = 'r2f_session';
export const DEVICE_COOKIE = 'r2f_device';

/**
 * Who a console socket belongs to, as JSON `{ label, exp }`: set by the Worker after it has signed the
 * console in, and deleted by the Worker from every incoming request.
 */
export const CONSOLE_HEADER = 'x-r2f-console';

function cookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** The device cookie or a Bearer API key (tablets and Companion). A session cookie never counts here. */
export function credentials(request: Request): Credentials {
  const c = cookies(request);
  const auth = request.headers.get('authorization') ?? '';
  return {
    ...(c[DEVICE_COOKIE] ? { device: c[DEVICE_COOKIE] } : {}),
    ...(auth.startsWith('Bearer ') ? { apiKey: auth.slice(7).trim() } : {}),
  };
}

/** The emergency sign-in's session cookie, used only on `/api/emergency/*`. */
export function sessionToken(request: Request): string | null {
  return cookies(request)[SESSION_COOKIE] || null;
}

export const hasCredentials = (c: Credentials) => Boolean(c.session || c.device || c.apiKey);
