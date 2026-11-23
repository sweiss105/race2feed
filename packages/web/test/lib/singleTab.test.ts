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
  return {
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
  } as unknown as LockManager;
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
    const second = claimTab({ locks, channel: mk(), onLost: vi.fn() });
    expect(await second.ready).toBe('blocked');
    await second.takeOver();
    expect(onLost1).toHaveBeenCalledTimes(1);
    const third = claimTab({ locks, channel: mk(), onLost: vi.fn() });
    expect(await third.ready).toBe('blocked');
  });

  it('is unsupported without a lock manager or channel', async () => {
    expect(await claimTab({ locks: undefined, channel: undefined, onLost: vi.fn() }).ready).toBe('unsupported');
    expect(await claimTab({ locks: fakeLocks(), channel: undefined, onLost: vi.fn() }).ready).toBe('unsupported');
  });
});
