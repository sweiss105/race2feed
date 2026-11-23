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

interface Pending { cmd: Cmd; key: string; laterRounds: number[]; changedRounds: number[] }

export function RunnerProvider({ send, children }: { send(cmd: object): Promise<Ack>; children: preact.ComponentChildren }) {
  const inFlight = useRef(new Set<string>());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
          const d = (ack.detail ?? {}) as { laterRounds?: number[]; changedRounds?: number[] };
          setPending({ cmd, key, laterRounds: d.laterRounds ?? [], changedRounds: d.changedRounds ?? [] });
        } else if (ack.code === 'changes_current_round') {
          setToast(ack.message ?? 'That would change the round in progress.');
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
              {pending.changedRounds.length
                ? <strong>This changes who races in {list(pending.changedRounds)}.</strong>
                : 'No matchups change.'}
            </p>
            <div class="sheet-actions">
              <Button kind="secondary" onClick={() => setPending(null)}>Cancel</Button>
              <Button kind="primary" onClick={() => { const p = pending; setPending(null); void run({ ...p.cmd, confirmUnlock: true }, p.key); }}>Change anyway</Button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div class="toast" role="alert">
          <span>{toast}</span>
          <Button kind="plain" onClick={() => setToast(null)}>OK</Button>
        </div>
      )}
    </RunnerContext.Provider>
  );
}
