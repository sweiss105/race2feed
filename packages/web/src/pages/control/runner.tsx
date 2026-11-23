import { createContext } from 'preact';
import { useContext, useRef, useState } from 'preact/hooks';
import type { Ack } from '../../lib/types';
import { Button } from '../../ui/Button';

type Cmd = { type: string } & Record<string, unknown>;

export interface Runner {
  /** Sends a command once; further calls with the same key are ignored until its ack arrives. */
  run(cmd: Cmd, key?: string): Promise<Ack | null>;
  busy(key: string): boolean;
  error(key: string): string | null;
}

const RunnerContext = createContext<Runner | null>(null);
export const useRunner = () => useContext(RunnerContext)!;

interface Pending { cmd: Cmd; key: string; laterRounds: number[]; keptRounds: number[] }

export function RunnerProvider({ send, children }: { send(cmd: object): Promise<Ack>; children: preact.ComponentChildren }) {
  const inFlight = useRef(new Set<string>());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);

  const setBusy = (key: string, on: boolean) => {
    on ? inFlight.current.add(key) : inFlight.current.delete(key);
    setBusyKeys(new Set(inFlight.current));
  };

  const run: Runner['run'] = async (cmd, key = cmd.type) => {
    if (inFlight.current.has(key)) return null;
    setBusy(key, true);
    setErrors(({ [key]: _, ...rest }) => rest);
    try {
      const ack = await send(cmd);
      if (!ack.ok) {
        if (ack.code === 'unlock_required') {
          const d = (ack.detail ?? {}) as { laterRounds?: number[]; keptRounds?: number[] };
          setPending({ cmd, key, laterRounds: d.laterRounds ?? [], keptRounds: d.keptRounds ?? [] });
        } else {
          setErrors((e) => ({ ...e, [key]: ack.message ?? 'Refused.' }));
        }
      }
      return ack;
    } catch (reason) {
      setErrors((e) => ({ ...e, [key]: reason === 'timeout' ? 'No answer from the server.' : 'Not connected.' }));
      return null;
    } finally {
      setBusy(key, false);
    }
  };

  const runner: Runner = { run, busy: (k) => busyKeys.has(k), error: (k) => errors[k] ?? null };
  const list = (r: number[]) => r.map((n) => `Round ${n}`).join(', ');

  return (
    <RunnerContext.Provider value={runner}>
      {children}
      {pending && (
        <div class="sheet-scrim" role="presentation" onClick={() => setPending(null)}>
          <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="unlock-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="unlock-title" class="title-2">Change an earlier round?</h2>
            <p class="callout">Later rounds have already been opened ({list(pending.laterRounds)}).</p>
            <p class="callout">
              {pending.keptRounds.length === 0
                ? 'No line-ups are affected.'
                : pending.keptRounds.length === 1
                  ? <strong>{list(pending.keptRounds)} was opened with its original line-up and keeps it. The corrected results will not match who raced there.</strong>
                  : <strong>{list(pending.keptRounds)} were opened with their original line-ups and keep them. The corrected results will not match who raced there.</strong>}
            </p>
            <div class="sheet-actions">
              <Button kind="secondary" onClick={() => setPending(null)}>Cancel</Button>
              <Button kind="primary" onClick={() => { const p = pending; setPending(null); void run({ ...p.cmd, confirmUnlock: true }, p.key); }}>Change anyway</Button>
            </div>
          </div>
        </div>
      )}
    </RunnerContext.Provider>
  );
}
