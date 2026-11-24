import { useEffect, useMemo, useState } from 'preact/hooks';
import { LiveConnection, wsUrl, type LiveStatus } from '../../lib/live';
import { ClockSync } from '../../lib/clock';
import { ACCESS_LOGOUT, CONTROL_API, consoleAuth, EMERGENCY_API, login, logout, type ApiBase, type ConsoleAuth, type Me } from '../../lib/api';
import type { ControlView } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Login } from './Login';
import { ConsolePage } from './ConsolePage';

type AuthView = ConsoleAuth | { state: 'loading' };

/** Asks `api` who is signed in; retries every 3 s while the server can't be reached. */
function useConsoleAuth(api: ApiBase) {
  const [auth, setAuth] = useState<AuthView>({ state: 'loading' });
  const refresh = () => {
    void (async () => {
      const next = await consoleAuth(api);
      setAuth(next);
      if (next.state === 'unknown') setTimeout(refresh, 3000);
    })();
  };
  useEffect(refresh, []);
  return [auth, setAuth, refresh] as const;
}

const Loading = () => <div class="center-page"><p class="secondary">Loading…</p></div>;
const Unreachable = () => <div class="center-page"><p class="secondary">Can’t reach the server — retrying…</p></div>;

function Notice({ message }: { message: string }) {
  return (
    <div class="center-page">
      <div class="card login">
        <p class="callout" role="alert" style={{ margin: 0 }}>{message}</p>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
    </div>
  );
}

/** `/control`: signed in by Cloudflare Access before the page loads; no sign-in form here. */
export function App() {
  const [auth, setAuth] = useConsoleAuth(CONTROL_API);
  switch (auth.state) {
    case 'loading': return <Loading />;
    case 'in': return <LiveConsole api={CONTROL_API} me={auth.me} signOutHref={ACCESS_LOGOUT} onSignedOut={() => setAuth({ state: 'out' })} />;
    case 'out': return <Notice message="You are not signed in. Reload this page to sign in." />;
    case 'not_configured': return <Notice message="Console sign-in is not set up." />;
    default: return <Unreachable />;
  }
}

/** `/emergency`: the emergency password, then the same console against `/api/emergency`. */
export function EmergencyApp() {
  const [auth, setAuth, refresh] = useConsoleAuth(EMERGENCY_API);
  switch (auth.state) {
    case 'loading': return <Loading />;
    case 'in': return (
      <LiveConsole api={EMERGENCY_API} me={auth.me} onSignedOut={() => setAuth({ state: 'out' })}
        onSignOut={() => void logout(EMERGENCY_API).finally(() => setAuth({ state: 'out' }))} />
    );
    case 'out': return <Login login={(password) => login(EMERGENCY_API, password)} onSignedIn={refresh} />;
    case 'not_found': return <div class="center-page"><p class="callout" role="alert">Emergency sign-in is not enabled.</p></div>;
    default: return <Unreachable />;
  }
}

function LiveConsole({ api, me, signOutHref, onSignOut, onSignedOut }: {
  api: ApiBase; me: Me; signOutHref?: string; onSignOut?(): void; onSignedOut(): void;
}) {
  const [view, setView] = useState<ControlView | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [conn, clock] = useMemo(() => {
    let clockRef: ClockSync | null = null;
    const c = new LiveConnection({
      url: wsUrl(`${api}/ws`),
      checkAuth: async () => (await consoleAuth(api)).state !== 'out',
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
  }, [api, onSignedOut]);

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
  return <ConsolePage api={api} me={me} view={view} send={send} serverNow={serverNow} status={status} signOutHref={signOutHref} onSignOut={onSignOut} />;
}
