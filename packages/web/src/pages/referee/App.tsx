import { useEffect, useMemo, useState } from 'preact/hooks';
import { Header } from '../../ui/Header';
import { StatusDot } from '../../ui/StatusDot';
import { LiveConnection, wsUrl, type LiveStatus } from '../../lib/live';
import { ClockSync } from '../../lib/clock';
import { TapQueue } from '../../lib/queue';
import type { RefereeView } from '../../lib/types';
import { RefereePage } from './RefereePage';
import { pairFromUrl } from './pairing';

type Gate = { kind: 'checking' } | { kind: 'unpaired'; error?: string } | { kind: 'paired' };

const meOk = async () => (await fetch('/api/me', { credentials: 'same-origin' })).ok;

export function App() {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });
  useEffect(() => {
    void (async () => {
      const pairing = await pairFromUrl(location.href, fetch, (path) => history.replaceState(null, '', path));
      if (pairing.paired) return setGate({ kind: 'paired' });
      const ok = await meOk().catch(() => false);
      setGate(ok ? { kind: 'paired' } : { kind: 'unpaired', ...('error' in pairing && pairing.error ? { error: pairing.error } : {}) });
    })();
  }, []);

  if (gate.kind === 'checking') return <div class="center-page"><p class="secondary">Checking this device…</p></div>;
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
  return <Live onSignedOut={() => setGate({ kind: 'unpaired', error: 'This device was disconnected. Scan a new station QR code.' })} />;
}

function Live({ onSignedOut }: { onSignedOut(): void }) {
  const [view, setView] = useState<RefereeView | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const queue = useMemo(() => new TapQueue(window.localStorage), []);
  const [conn, clock] = useMemo(() => {
    let clockRef: ClockSync | null = null;
    const burst = () => { clockRef?.reset(); [0, 250, 500].forEach((ms) => setTimeout(() => clockRef?.ping(), ms)); };
    const c = new LiveConnection({
      url: wsUrl('/api/ws'),
      checkAuth: () => meOk(),
      onStatus: (s) => {
        setStatus(s);
        if (s === 'open') { burst(); clockRef?.start(5000); }
        if (s === 'signed-out') onSignedOut();
      },
      onMessage: (msg) => {
        if (msg.type === 'view') setView(msg.view as RefereeView);
        else if (msg.type === 'pong') clockRef?.handlePong(msg);
      },
    });
    clockRef = new ClockSync(c);
    // After the phone wakes, re-sync the clock before any new tap is stamped.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') burst(); });
    return [c, clockRef] as const;
  }, [onSignedOut]);

  const [, force] = useState(0);
  useEffect(() => {
    conn.start();
    const t = setInterval(() => force((n) => n + 1), 1000); // refresh "synced" state
    return () => { conn.stop(); clock.stop(); clearInterval(t); };
  }, [conn, clock]);

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
