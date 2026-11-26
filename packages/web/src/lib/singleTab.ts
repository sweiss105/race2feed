const NAME = 'r2f-referee';

export type TabState = 'active' | 'blocked' | 'unsupported';

export interface ClaimOptions {
  locks?: LockManager;
  channel?: BroadcastChannel;
  /** Called when another tab takes over from this one. */
  onLost(): void;
  /** Wait before a refused first claim is tried once more (a reload's old page may not have let go yet). */
  retryMs?: number;
}

type Outcome = 'got' | 'refused' | 'error';

/**
 * Lets only one referee tab per device run the tap queue. The first tab holds a Web Lock;
 * later tabs are `blocked` until the person chooses `takeOver()`, which makes the holder let go.
 * Without Web Locks or BroadcastChannel (or if the lock request fails) the answer is `unsupported`
 * and nothing is enforced.
 * A key given in `opts` (even as undefined) is used as is; only an omitted key falls back to the browser's.
 */
export function claimTab(opts: ClaimOptions): { ready: Promise<TabState>; takeOver(): Promise<void>; release(): void } {
  const locks = 'locks' in opts ? opts.locks : typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const opened = !('channel' in opts) && typeof BroadcastChannel !== 'undefined';
  const channel = 'channel' in opts ? opts.channel : opened ? new BroadcastChannel(NAME) : undefined;
  if (!locks || !channel) {
    if (opened) channel?.close();
    return { ready: Promise.resolve('unsupported'), takeOver: async () => {}, release: () => {} };
  }

  let dropLock: (() => void) | null = null;
  let closed = false;

  // Resolves once the lock is granted or refused; a granted lock stays held until dropLock() is called.
  const hold = (lockOpts: LockOptions): Promise<Outcome> =>
    new Promise<Outcome>((resolve) => {
      try {
        void locks.request(NAME, lockOpts, (lock) => {
          if (!lock || closed) { resolve('refused'); return undefined; }
          resolve('got');
          return new Promise<void>((release) => { dropLock = () => { dropLock = null; release(); }; });
        }).catch(() => resolve('error'));
      } catch {
        resolve('error');
      }
    });

  channel.onmessage = (e: MessageEvent) => {
    if (e.data !== 'takeover' || !dropLock) return;
    dropLock();
    opts.onLost();
  };

  const closeChannel = () => { channel.onmessage = null; channel.close(); };

  const ready = (async (): Promise<TabState> => {
    let outcome = await hold({ ifAvailable: true });
    if (outcome === 'refused') {
      await new Promise((r) => setTimeout(r, opts.retryMs ?? 400));
      outcome = await hold({ ifAvailable: true });
    }
    if (outcome === 'error') { closeChannel(); return 'unsupported'; }
    return outcome === 'got' ? 'active' : 'blocked';
  })();

  let pending: Promise<void> | null = null;
  return {
    ready,
    takeOver() {
      if (dropLock) return Promise.resolve();
      if (!pending) {
        channel.postMessage('takeover');
        pending = hold({}).then(() => {}).finally(() => { pending = null; });
      }
      return pending;
    },
    release() {
      closed = true;
      dropLock?.();
      closeChannel();
    },
  };
}
