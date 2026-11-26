import { useEffect, useState } from 'preact/hooks';
import { Header } from '../../ui/Header';
import { LiveConnection, wsUrl, type LiveStatus } from '../../lib/live';
import { applyRoundUpdate, applySnapshot, type PublicState } from '../../lib/publicState';
import { ParticipantPage } from './ParticipantPage';
import { StatusDot } from '../../ui/StatusDot';

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  useEffect(() => {
    const conn = new LiveConnection({
      url: wsUrl('/api/ws?role=public'),
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'snapshot') setState(msg.view ? applySnapshot(msg.view) : null);
        else if (msg.type === 'round') setState((s) => (s ? applyRoundUpdate(s, msg.update) : s));
      },
    });
    conn.start();
    return () => conn.stop();
  }, []);
  return (
    <>
      <Header title={state?.event.name ?? 'PRC'} trailing={<StatusDot status={status} />} />
      {state ? <ParticipantPage state={state} storage={window.localStorage} /> : (
        <div class="center-page"><p class="secondary">{status === 'open' ? 'No event is running yet.' : 'Connecting…'}</p></div>
      )}
    </>
  );
}
