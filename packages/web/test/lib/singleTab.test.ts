import { describe, it, expect, vi } from 'vitest';
import { claimTab } from '../../src/lib/singleTab';

/** In-memory lock manager: a lock is held until the callback's promise settles; waiting requests queue. */
function fakeLocks() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const run = async (name: string, cb: (lock: object | null) => Promise<unknown>) => {
    held.add(name);
    try { await cb({ name }); } finally {
      held.delete(name);
      waiting.get(name)?.shift()?.();
    }
  };
  const mgr = {
    request(name: string, opts: any, cb: (lock: object | null) => Promise<unknown>) {
      if (opts?.ifAvailable) {
        if (held.has(name)) return Promise.resolve(cb(null));
        return run(name, cb);
      }
      if (!held.has(name)) return run(name, cb);
      return new Promise<void>((resolve) => {
        const q = waiting.get(name) ?? [];
        q.push(() => { void run(name, cb).then(resolve); });
        waiting.set(name, q);
      });
    },
    queued: (name: string) => waiting.get(name)?.length ?? 0,
    /** Holds the lock until the returned function is called, without answering takeover messages. */
    hold(name: string) {
      let free!: () => void;
      void (mgr as unknown as LockManager).request(name, {}, () => new Promise<void>((r) => { free = r; }));
      return () => free();
    },
  };
  return mgr as unknown as LockManager & { queued(name: string): number; hold(name: string): () => void };
}

/** Channels with the same name deliver to every other instance. */
function fakeChannelFactory() {
  const all: FakeChannel[] = [];
  class FakeChannel {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    constructor(public name: string) { all.push(this); }
    postMessage(data: unknown) { for (const c of all) if (c !== this && c.name === this.name) c.onmessage?.({ data }); }
    close() { all.splice(all.indexOf(this), 1); }
  }
  return () => new FakeChannel('r2f-referee') as unknown as BroadcastChannel;
}

describe('claimTab', () => {
  it('lets the first tab be active, blocks the second, and hands over on takeOver', async () => {
    const locks = fakeLocks();
    const mk = fakeChannelFactory();
    const onLost1 = vi.fn();
    const first = claimTab({ locks, channel: mk(), onLost: onLost1 });
    expect(await first.ready).toBe('active');
    const second = claimTab({ locks, channel: mk(), onLost: vi.fn(), retryMs: 0 });
    expect(await second.ready).toBe('blocked');
    await second.takeOver();
    expect(onLost1).toHaveBeenCalledTimes(1);
    const third = claimTab({ locks, channel: mk(), onLost: vi.fn(), retryMs: 0 });
    expect(await third.ready).toBe('blocked');
  });

  it('is unsupported without a lock manager or channel', async () => {
    expect(await claimTab({ locks: undefined, channel: undefined, onLost: vi.fn() }).ready).toBe('unsupported');
    expect(await claimTab({ locks: fakeLocks(), channel: undefined, onLost: vi.fn() }).ready).toBe('unsupported');
  });

  it('is unsupported when the lock request rejects', async () => {
    const locks = { request: () => Promise.reject(new Error('SecurityError')) } as unknown as LockManager;
    const mk = fakeChannelFactory();
    expect(await claimTab({ locks, channel: mk(), onLost: vi.fn(), retryMs: 0 }).ready).toBe('unsupported');
    const throwing = { request: () => { throw new Error('boom'); } } as unknown as LockManager;
    expect(await claimTab({ locks: throwing, channel: mk(), onLost: vi.fn(), retryMs: 0 }).ready).toBe('unsupported');
  });

  it('closes a channel it opened itself when locks are unsupported', async () => {
    const close = vi.fn();
    class Ch { onmessage = null; postMessage() {} close = close; }
    vi.stubGlobal('BroadcastChannel', Ch);
    try {
      expect(await claimTab({ locks: undefined, onLost: vi.fn() }).ready).toBe('unsupported');
      expect(close).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('retries once so a reload does not see its own old lock', async () => {
    const locks = fakeLocks();
    const mk = fakeChannelFactory();
    const free = locks.hold('r2f-referee');
    const c = claimTab({ locks, channel: mk(), onLost: vi.fn(), retryMs: 20 });
    free();
    expect(await c.ready).toBe('active');
    const free2 = fakeLocks();
    free2.hold('r2f-referee');
    expect(await claimTab({ locks: free2, channel: mk(), onLost: vi.fn(), retryMs: 5 }).ready).toBe('blocked');
  });

  it('takeOver is idempotent while pending', async () => {
    const locks = fakeLocks();
    const post = vi.fn();
    const channel = { postMessage: post, close() {}, onmessage: null } as unknown as BroadcastChannel;
    locks.hold('r2f-referee');
    const c = claimTab({ locks, channel, onLost: vi.fn(), retryMs: 0 });
    expect(await c.ready).toBe('blocked');
    const a = c.takeOver();
    const b = c.takeOver();
    expect(b).toBe(a);
    expect(post).toHaveBeenCalledTimes(1);
    expect(locks.queued('r2f-referee')).toBe(1);
  });

  it('takeOver back and forth changes hands once each time', async () => {
    const locks = fakeLocks();
    const mk = fakeChannelFactory();
    const lostA = vi.fn();
    const lostB = vi.fn();
    const a = claimTab({ locks, channel: mk(), onLost: lostA, retryMs: 0 });
    expect(await a.ready).toBe('active');
    const b = claimTab({ locks, channel: mk(), onLost: lostB, retryMs: 0 });
    expect(await b.ready).toBe('blocked');
    await b.takeOver();
    expect(lostA).toHaveBeenCalledTimes(1);
    await a.takeOver();
    expect(lostB).toHaveBeenCalledTimes(1);
    expect(lostA).toHaveBeenCalledTimes(1);
    await a.takeOver(); // already holds the lock: nothing happens
    expect(lostB).toHaveBeenCalledTimes(1);
    expect(locks.queued('r2f-referee')).toBe(0);
  });
});
