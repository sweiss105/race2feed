import { describe, it, expect } from 'vitest';
import { TapQueue } from '../../src/lib/queue';
import { MemoryStorage } from './fakes';

const entry = (id: string) => ({ clientTapId: id, cmd: { type: 'tapFinish', clientTapId: id } });

describe('TapQueue', () => {
  it('survives a reload', () => {
    const storage = new MemoryStorage();
    new TapQueue(storage).add(entry('a'));
    expect(new TapQueue(storage).all().map((e) => e.clientTapId)).toEqual(['a']);
  });

  it('drops entries on ok or a final refusal, keeps them otherwise', () => {
    const q = new TapQueue(new MemoryStorage());
    ['a', 'b', 'c'].forEach((id) => q.add(entry(id)));
    q.settle('a', { ok: true });
    q.settle('b', { ok: false, code: 'already_finished' });
    q.settle('c', { ok: false, code: 'something_temporary' });
    expect(q.all().map((e) => e.clientTapId)).toEqual(['c']);
  });

  it('keeps an entry the server failed to process', () => {
    const q = new TapQueue(new MemoryStorage());
    q.add(entry('a'));
    q.settle('a', { ok: false, code: 'server_error' });
    expect(q.all().map((e) => e.clientTapId)).toEqual(['a']);
  });

  it('flushes each entry once, in order, and stops at a network failure', async () => {
    const q = new TapQueue(new MemoryStorage());
    ['a', 'b', 'c'].forEach((id) => q.add(entry(id)));
    const sent: string[] = [];
    await q.flush(async (cmd: any) => {
      sent.push(cmd.clientTapId);
      if (cmd.clientTapId === 'b') throw 'offline';
      return { ok: true };
    });
    expect(sent).toEqual(['a', 'b']);
    expect(q.all().map((e) => e.clientTapId)).toEqual(['b', 'c']);
    sent.length = 0;
    await q.flush(async (cmd: any) => { sent.push(cmd.clientTapId); return { ok: true }; });
    expect(sent).toEqual(['b', 'c']);
    expect(q.all()).toEqual([]);
  });

  it('does not run two flushes at once', async () => {
    const q = new TapQueue(new MemoryStorage());
    q.add(entry('a'));
    let calls = 0;
    const send = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { ok: true }; };
    await Promise.all([q.flush(send), q.flush(send)]);
    expect(calls).toBe(1);
  });

  it('keeps taps in memory when storage cannot be written', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const q = new TapQueue(storage);
    q.add(entry('a'));
    expect(q.all().map((e) => e.clientTapId)).toEqual(['a']);
    q.settle('a', { ok: true });
    expect(q.all()).toEqual([]);
  });

  it('reports every answer from a flush', async () => {
    const q = new TapQueue(new MemoryStorage());
    ['a', 'b'].forEach((id) => q.add(entry(id)));
    const seen: [string, boolean][] = [];
    await q.flush(async (cmd: any) => (cmd.clientTapId === 'a' ? { ok: true } : { ok: false, code: 'already_finished', message: 'no' }),
      (e, ack) => seen.push([e.clientTapId, ack.ok]));
    expect(seen).toEqual([['a', true], ['b', false]]);
  });
});
