import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../../ui/Button';
import { Header } from '../../ui/Header';
import { StatusDot } from '../../ui/StatusDot';
import { LiveConnection, wsUrl, type LiveStatus } from '../../lib/live';
import { ClockSync } from '../../lib/clock';
import { TapQueue } from '../../lib/queue';
import { authState } from '../../lib/api';
import type { RefereeView } from '../../lib/types';
import { RefereePage } from './RefereePage';
import { codeFromUrl, pair } from './pairing';
import { claimTab } from '../../lib/singleTab';

type Gate = { kind: 'checking'; retrying?: boolean } | { kind: 'name'; code: string } | { kind: 'unpaired'; error?: string } | { kind: 'paired' };

export function App() {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A station QR code asks for the referee's name before pairing.
      const code = codeFromUrl(location.href);
      if (code) return setGate({ kind: 'name', code });
      // A server error is not "unpaired": keep checking until the server answers.
      for (;;) {
        const state = await authState(() => fetch('/api/me?as=referee'));
        if (cancelled) return;
        if (state === 'in') return setGate({ kind: 'paired' });
        if (state === 'out') return setGate({ kind: 'unpaired' });
        setGate({ kind: 'checking', retrying: true });
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Resolves to a message when the form should stay (the code is still unspent). */
  const submitName = async (code: string, name: string): Promise<string | null> => {
    const result = await pair(code, name, fetch);
    if (result.paired) {
      history.replaceState(null, '', location.pathname);
      setGate({ kind: 'paired' });
      return null;
    }
    if (result.retry) return result.error;
    // The server has answered, so the single-use code is gone from the address either way.
    history.replaceState(null, '', location.pathname);
    // A device that is still paired from before stays paired.
    const state = await authState(() => fetch('/api/me?as=referee'));
    setGate(state === 'in' ? { kind: 'paired' } : { kind: 'unpaired', error: result.error });
    return null;
  };

  if (gate.kind === 'checking') {
    return <div class="center-page"><p class="secondary">{gate.retrying ? 'Can’t reach the server — retrying…' : 'Checking this device…'}</p></div>;
  }
  if (gate.kind === 'name') return <NameForm onSubmit={(name) => submitName(gate.code, name)} />;
  if (gate.kind === 'unpaired') {
    return (
      <div class="ref">
        <Header title="Referee" />
        <div class="center-page">
          <h1 class="title-1">Scan the station QR code</h1>
          <p class="secondary callout">Race control shows a QR code for each pair of tables under Devices.</p>
          {gate.error && <p class="callout" style={{ color: 'var(--danger)' }}>{gate.error}</p>}
        </div>
      </div>
    );
  }
  return <OneTab><Live onSignedOut={() => setGate({ kind: 'unpaired', error: 'This device was disconnected. Scan a new station QR code.' })} /></OneTab>;
}

function NameForm({ onSubmit }: { onSubmit(name: string): Promise<string | null> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    void onSubmit(name.trim()).then((retry) => { setError(retry); setBusy(false); });
  };
  return (
    <div class="ref">
      <Header title="Referee" />
      <div class="center-page">
        <form class="card login" onSubmit={submit}>
          <label class="field">
            <span class="footnote secondary">Your name</span>
            <input class="input" type="text" maxLength={40} autocomplete="name" value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          {error && <p class="callout" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
          <Button type="submit" busy={busy} disabled={!name.trim()}>Start</Button>
        </form>
      </div>
    </div>
  );
}

/** Renders its children only in the one live referee tab; other tabs offer to take over. */
function OneTab({ children }: { children: ComponentChildren }) {
  const [state, setState] = useState<'claiming' | 'live' | 'other'>('claiming');
  const claim = useRef<ReturnType<typeof claimTab> | null>(null);
  useEffect(() => {
    const c = claimTab({ onLost: () => setState('other') });
    claim.current = c;
    let gone = false;
    void c.ready.then((r) => { if (!gone) setState(r === 'blocked' ? 'other' : 'live'); });
    return () => { gone = true; c.release(); };
  }, []);
  if (state === 'claiming') return <div class="center-page"><p class="secondary">Checking this device…</p></div>;
  if (state === 'other') {
    return (
      <div class="ref">
        <Header title="Referee" />
        <div class="center-page">
          <p class="callout">The referee page is already open in another tab on this tablet</p>
          <Button onClick={() => { void claim.current?.takeOver().then(() => setState('live')); }}>Use this tab instead</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function Live({ onSignedOut }: { onSignedOut(): void }) {
  const [view, setView] = useState<RefereeView | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const queue = useMemo(() => new TapQueue(window.localStorage), []);
  const [conn, clock, burst] = useMemo(() => {
    let clockRef: ClockSync | null = null;
    const quickSync = () => [0, 250, 500].forEach((ms) => setTimeout(() => clockRef?.ping(), ms));
    const c = new LiveConnection({
      url: wsUrl('/api/ws?role=referee'),
      checkAuth: async () => (await authState(() => fetch('/api/me?as=referee'))) !== 'out',
      onStatus: (s) => {
        setStatus(s);
        if (s === 'open') quickSync();
        if (s === 'signed-out') onSignedOut();
      },
      onMessage: (msg) => {
        if (msg.type === 'view') setView(msg.view as RefereeView);
        else if (msg.type === 'pong') clockRef?.handlePong(msg);
      },
    });
    clockRef = new ClockSync(c);
    // After waking: prefer fresh samples, but keep the old offset so taps still work offline.
    const onWake = () => { clockRef?.markStale(); quickSync(); };
    return [c, clockRef, onWake] as const;
  }, [onSignedOut]);

  const [, force] = useState(0);
  useEffect(() => {
    conn.start();
    const wake = () => { if (document.visibilityState === 'visible') burst(); };
    document.addEventListener('visibilitychange', wake);
    const t = setInterval(() => force((n) => n + 1), 1000); // refresh "synced" state
    return () => { conn.stop(); clock.stop(); clearInterval(t); document.removeEventListener('visibilitychange', wake); };
  }, [conn, clock, burst]);

  useEffect(() => {
    const live = view?.round.phase === 'open' || view?.round.phase === 'running';
    clock.setInterval(live ? 5000 : 30_000);
    // Keep the screen on while a round is open or running.
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    const request = () => { if (live && nav.wakeLock && document.visibilityState === 'visible') nav.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    request();
    document.addEventListener('visibilitychange', request);
    return () => { document.removeEventListener('visibilitychange', request); void lock?.release().catch(() => {}); };
  }, [view?.round.phase, clock]);

  const send = useMemo(() => (cmd: object) => conn.command(cmd), [conn]);
  return (
    <div class="ref">
      <Header title="Referee" trailing={<StatusDot status={status} />} />
      <RefereePage view={view} status={status} clock={clock} queue={queue} send={send}
        newId={() => crypto.randomUUID()} vibrate={(ms) => navigator.vibrate?.(ms)} />
    </div>
  );
}
