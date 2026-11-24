/** `retry`: the code is unspent (network failure, 5xx or 429), so the same code can be tried again. */
export type PairResult = { paired: false; error: string; retry: boolean } | { paired: true; station: number };

const UNREACHABLE = "Can't reach the server. Check the connection and press Start again.";

/** The pairing code from a station QR link (`/ref?code=…`), if there is one. */
export function codeFromUrl(href: string): string | null {
  return new URL(href).searchParams.get('code') || null;
}

/** Pairs this device to the station behind `code`, recording the referee's name. */
export async function pair(code: string, name: string, fetchFn: typeof fetch): Promise<PairResult> {
  try {
    const res = await fetchFn('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
    if (res.status >= 500 || res.status === 429) return { paired: false, retry: true, error: UNREACHABLE };
    if (!res.ok) return { paired: false, retry: false, error: 'This pairing code is invalid or already used. Ask race control for a new one.' };
    const body = (await res.json()) as { station: number };
    return { paired: true, station: body.station };
  } catch {
    return { paired: false, retry: true, error: UNREACHABLE };
  }
}
