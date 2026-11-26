import { useEffect, useMemo, useState } from 'preact/hooks';
import { LiveConnection, wsUrl } from '../../lib/live';
import { ClockSync } from '../../lib/clock';
import { applyRoundUpdate, applySnapshot, type PublicState } from '../../lib/publicState';
import { ProjectorPage } from './ProjectorPage';

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [conn, clock] = useMemo(() => {
    let clockRef: ClockSync | null = null;
    const c = new LiveConnection({
      url: wsUrl('/api/ws?role=public'),
      onStatus: (s) => { if (s === 'open') clockRef?.start(5000); },
      onMessage: (msg) => {
        if (msg.type === 'snapshot') setState(msg.view ? applySnapshot(msg.view) : null);
        else if (msg.type === 'round') setState((s) => (s ? applyRoundUpdate(s, msg.update) : s));
        else if (msg.type === 'pong') clockRef?.handlePong(msg);
      },
    });
    clockRef = new ClockSync(c);
    return [c, clockRef] as const;
  }, []);

  useEffect(() => {
    conn.start();
    return () => { conn.stop(); clock.stop(); };
  }, [conn, clock]);

  useEffect(() => {
    const live = state?.round.phase === 'open' || state?.round.phase === 'running';
    clock.setInterval(live ? 5000 : 30_000);
  }, [state?.round.phase, clock]);

  // ?bg=transparent drops the page background so a video mixer (OBS) can put its own behind the text.
  useEffect(() => {
    const clear = new URLSearchParams(location.search).get('bg') === 'transparent';
    document.documentElement.classList.toggle('proj-clear', clear);
    return () => document.documentElement.classList.remove('proj-clear');
  }, []);

  // Hide the cursor after 3 s without movement.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 3000);
    const move = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); };
    window.addEventListener('pointermove', move);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', move); };
  }, []);

  const serverNow = useMemo(() => () => clock.serverNow(), [clock]);
  if (!state) return <div class="proj center-page"><p class="proj-sub">Connecting…</p></div>;
  return (
    <div class={idle ? 'hide-cursor' : ''}>
      <ProjectorPage state={state} serverNow={serverNow} siteUrl={`${location.origin}/`} />
    </div>
  );
}
