import type { Ack } from './types';

export interface QueuedTap { clientTapId: string; cmd: object }

/** Refusals that will never succeed on retry. */
export const NON_RETRYABLE = new Set([
  'already_finished', 'not_your_team', 'bad_timestamp', 'penalties_disabled', 'round_not_running', 'invalid', 'forbidden',
]);

/** Referee taps kept in localStorage until the server has answered them. */
export class TapQueue {
  private flushing: Promise<number> | null = null;

  constructor(private storage: Storage, private key = 'r2f.tapQueue') {}

  all(): QueuedTap[] {
    try {
      const raw = this.storage.getItem(this.key);
      return raw ? (JSON.parse(raw) as QueuedTap[]) : [];
    } catch {
      return [];
    }
  }

  private save(list: QueuedTap[]) {
    try {
      this.storage.setItem(this.key, JSON.stringify(list));
    } catch {
      /* storage full or blocked: keep going in memory */
    }
  }

  add(entry: QueuedTap) {
    this.save([...this.all(), entry]);
  }

  settle(clientTapId: string, ack: Ack) {
    if (ack.ok || (ack.code && NON_RETRYABLE.has(ack.code))) {
      this.save(this.all().filter((e) => e.clientTapId !== clientTapId));
    }
  }

  /** Sends queued taps in order; stops at the first network failure. Returns how many were sent. */
  flush(send: (cmd: object) => Promise<Ack>): Promise<number> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let sent = 0;
      try {
        for (const entry of this.all()) {
          const ack = await send(entry.cmd);
          sent++;
          this.settle(entry.clientTapId, ack);
        }
      } catch {
        /* offline or timeout: keep the rest for later */
      }
      return sent;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
