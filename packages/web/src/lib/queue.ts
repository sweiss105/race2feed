import type { Ack } from './types';

export interface QueuedTap { clientTapId: string; cmd: object; /** Round the tap was made in. */ round?: number }

/** Refusals that will never succeed on retry. */
export const NON_RETRYABLE = new Set([
  'already_finished', 'not_your_team', 'bad_timestamp', 'penalties_disabled', 'round_not_running', 'invalid', 'forbidden',
]);

/** Referee taps kept in memory, written through to localStorage until the server has answered them. */
export class TapQueue {
  private flushing: Promise<number> | null = null;
  private list: QueuedTap[];

  constructor(private storage: Storage, private key = 'r2f.tapQueue') {
    this.list = this.load();
  }

  private load(): QueuedTap[] {
    try {
      const raw = this.storage.getItem(this.key);
      return raw ? (JSON.parse(raw) as QueuedTap[]) : [];
    } catch {
      return [];
    }
  }

  all(): QueuedTap[] {
    return [...this.list];
  }

  private save(list: QueuedTap[]) {
    this.list = list;
    try {
      this.storage.setItem(this.key, JSON.stringify(list));
    } catch {
      /* storage full or blocked: the list stays in memory */
    }
  }

  /** Removes entries matching `pred` (e.g. taps from a round that is over). */
  drop(pred: (entry: QueuedTap) => boolean) {
    const keep = this.list.filter((e) => !pred(e));
    if (keep.length !== this.list.length) this.save(keep);
  }

  add(entry: QueuedTap) {
    this.save([...this.list, entry]);
  }

  settle(clientTapId: string, ack: Ack) {
    if (ack.ok || (ack.code && NON_RETRYABLE.has(ack.code))) {
      this.save(this.list.filter((e) => e.clientTapId !== clientTapId));
    }
  }

  /** Sends queued taps in order; stops at the first network failure. Returns how many were sent. */
  flush(send: (cmd: object) => Promise<Ack>, onAnswer?: (entry: QueuedTap, ack: Ack) => void): Promise<number> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let sent = 0;
      try {
        for (const entry of this.all()) {
          const ack = await send(entry.cmd);
          sent++;
          this.settle(entry.clientTapId, ack);
          onAnswer?.(entry, ack);
        }
      } catch {
        /* offline or timeout: keep the rest for later */
      }
      return sent;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
