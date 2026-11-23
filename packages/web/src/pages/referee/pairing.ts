export type PairResult = { paired: false; error?: string } | { paired: true; station: number };

/** If the page was opened from a station QR code (?code=…), pair this device and tidy the URL. */
export async function pairFromUrl(href: string, fetchFn: typeof fetch, replaceUrl: (path: string) => void): Promise<PairResult> {
  const url = new URL(href);
  const code = url.searchParams.get('code');
  if (!code) return { paired: false };
  replaceUrl(url.pathname);
  try {
    const res = await fetchFn('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return { paired: false, error: 'This pairing code is invalid or already used. Ask race control for a new one.' };
    const body = (await res.json()) as { station: number };
    return { paired: true, station: body.station };
  } catch {
    return { paired: false, error: 'Could not reach the server. Check the connection and scan again.' };
  }
}
