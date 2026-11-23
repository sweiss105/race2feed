import { describe, it, expect } from 'vitest';
import { ClockSync } from '../../src/lib/clock';

describe('ClockSync', () => {
  it('uses the median of the fastest round trips', () => {
    let now = 1_000;
    const sent: any[] = [];
    const clock = new ClockSync({ send: (m) => sent.push(m) }, () => now);
    // server is 5000 ms ahead; slow samples carry large errors
    const sample = (rtt: number, error = 0) => {
      const t0 = now;
      now += rtt;
      clock.handlePong({ t0, t1: t0 + rtt / 2 + 5000 + error });
    };
    expect(clock.synced()).toBe(false);
    sample(400, 300);
    sample(20);
    sample(30);
    expect(clock.synced()).toBe(true);
    sample(25);
    sample(500, -400);
    sample(22);
    sample(28);
    expect(clock.offset()).toBe(5000);
    expect(clock.serverNow()).toBe(now + 5000);
  });

  it('keeps the old offset usable after waking until fresh samples arrive', () => {
    let now = 0;
    const clock = new ClockSync({ send: () => {} }, () => now);
    for (let i = 0; i < 3; i++) { const t0 = now; now += 20; clock.handlePong({ t0, t1: t0 + 10 + 5000 }); }
    expect(clock.offset()).toBe(5000);
    clock.markStale();
    expect(clock.synced()).toBe(true);
    expect(clock.offset()).toBe(5000);
    const t0 = now; now += 20; clock.handlePong({ t0, t1: t0 + 10 + 7000 });
    expect(clock.offset()).toBe(7000);
  });

  it('pings on start and on its interval', () => {
    let now = 0;
    const sent: any[] = [];
    const timers: (() => void)[] = [];
    const clock = new ClockSync({ send: (m) => sent.push(m) }, () => now, (fn) => { timers.push(fn); return timers.length; }, () => {});
    clock.start(5000);
    expect(sent).toEqual([{ type: 'ping', t0: 0 }]);
    now = 5000;
    timers[0]!();
    expect(sent.length).toBe(2);
  });
});
