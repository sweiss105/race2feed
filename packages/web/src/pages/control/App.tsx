import { useEffect, useMemo, useState } from 'preact/hooks';
import { LiveConnection, wsUrl, type LiveStatus } from '../../lib/live';
import { ClockSync } from '../../lib/clock';
import { login, logout, me as fetchMe, type Me } from '../../lib/api';
import type { ControlView } from '../../lib/types';
import { Login } from './Login';
import { ConsolePage } from './ConsolePage';

export function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const refresh = () => void fetchMe().then(setMe).catch(() => setMe(null));
  useEffect(refresh, []);
  if (me === 'loading') return <div class="center-page"><p class="secondary">Loading…</p></div>;
  if (!me || (me.role !== 'admin' && me.role !== 'control')) return <Login login={login} onSignedIn={refresh} />;
  return <LiveConsole me={me} onSignOut={() => void logout().then(() => setMe(null))} onSignedOut={() => setMe(null)} />;
}

function LiveConsole({ me, onSignOut, onSignedOut }: { me: Me; onSignOut(): void; onSignedOut(): void }) {
  const [view, setView] = useState<ControlView | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [conn, clock] = useMemo(() => {
    let clockRef: ClockSync | null = null;
    const c = new LiveConnection({
      url: wsUrl('/api/ws'),
      checkAuth: async () => (await fetchMe().catch(() => null)) !== null,
      onStatus: (s) => {
        setStatus(s);
        if (s === 'open') clockRef?.start(5000);
        if (s === 'signed-out') onSignedOut();
      },
      onMessage: (msg) => {
        if (msg.type === 'view') setView(msg.view as ControlView | null);
        else if (msg.type === 'pong') clockRef?.handlePong(msg);
      },
    });
    clockRef = new ClockSync(c);
    return [c, clockRef] as const;
  }, [onSignedOut]);

  useEffect(() => {
    conn.start();
    return () => { conn.stop(); clock.stop(); };
  }, [conn, clock]);

  useEffect(() => {
    const live = view?.round.phase === 'open' || view?.round.phase === 'running';
    clock.setInterval(live ? 5000 : 30_000);
  }, [view?.round.phase, clock]);

  const send = useMemo(() => (cmd: object) => conn.command(cmd), [conn]);
  const serverNow = useMemo(() => () => clock.serverNow(), [clock]);
  return <ConsolePage me={me} view={view} send={send} serverNow={serverNow} status={status} onSignOut={onSignOut} />;
}
