import { useEffect, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { QR } from '../../../ui/QR';
import { useRunner } from '../runner';
import { stationCount, tablesOfStation } from '@race2feed/engine';
import { stationLabel } from '../../../lib/selectors';

interface Device { id: string; station: number; label: string; created_at: number; revoked_at: number | null; last_seen: number | null }
interface Pairing { station: number; code: string; expiresAt: number }

export function Devices({ view }: { view: ControlView }) {
  const runner = useRunner();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const per = view.setup.tablesPerStation ?? 2;
  const stations = stationCount(view.setup.tableCount, per);
  const devices = (view.devices as Device[]).filter((d) => d.revoked_at === null);
  // With saved assignments for the round (rotation on), say where each referee is now.
  const thisRound = (deviceId: string) => {
    const tables = view.assignments.find((a) => a.deviceId === deviceId)?.tables;
    return tables ? `this round: ${stationLabel(tables)}` : 'no tables this round';
  };
  const pair = async (station: number) => {
    const ack = await runner.run({ type: 'createPairingCode', station }, `pair-${station}`);
    const reply = ack?.ok ? (ack.reply as { code: string; expiresAt: number }) : null;
    if (reply) setPairing({ station, ...reply });
  };
  return (
    <>
      <h2 class="title-1">Referees</h2>
      <p class="secondary callout">Open a station's QR code, then scan it with that referee's phone or tablet. Codes work once and expire after 10 minutes.</p>
      {pairing && <PairingCard pairing={pairing} onClose={() => setPairing(null)} />}
      <section class="panel">
        <table class="table">
          <thead><tr><th>{view.settings.rotateReferees ? 'Starting station' : 'Station'}</th><th>Paired devices</th><th /></tr></thead>
          <tbody>
            {Array.from({ length: stations }, (_, i) => i + 1).map((s) => {
              const tables = stationLabel(tablesOfStation(s, view.setup.tableCount, per));
              const mine = devices.filter((d) => d.station === s);
              return (
                <tr key={s}>
                  <td class="headline">{tables}</td>
                  <td>
                    {mine.length === 0 ? <span class="secondary">None</span> : mine.map((d) => (
                      <div key={d.id} class="race-actions">
                        <span class="callout">{d.label} — {tables}</span>
                        {view.assignments.length > 0 && <span class="footnote secondary">{thisRound(d.id)}</span>}
                        <span class="footnote secondary">{d.last_seen ? `seen ${new Date(d.last_seen).toLocaleTimeString()}` : 'not seen yet'}</span>
                        <Button kind="destructive" busy={runner.busy(`revoke-${d.id}`)} onClick={() => void runner.run({ type: 'revokeDevice', deviceId: d.id }, `revoke-${d.id}`)}>Revoke</Button>
                      </div>
                    ))}
                  </td>
                  <td><Button kind="secondary" aria-label={`Pair device for ${tables}`} busy={runner.busy(`pair-${s}`)} onClick={() => void pair(s)}>Pair device</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function PairingCard({ pairing, onClose }: { pairing: Pairing; onClose(): void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((pairing.expiresAt - now) / 1000));
  const url = `${location.origin}/ref?code=${pairing.code}`;
  return (
    <div class="panel card" style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'center', flexWrap: 'wrap' }}>
      <QR value={url} size="14rem" label={`Pairing QR code for station ${pairing.station}`} />
      <div class="stack">
        <span class="headline">Station {pairing.station}</span>
        <span class="title-1 tabular" style={{ letterSpacing: '0.08em' }}>{pairing.code}</span>
        <span class="footnote secondary">{left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — make a new code'}</span>
        <Button kind="secondary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
