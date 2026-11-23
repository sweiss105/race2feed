interface Sample { rtt: number; offset: number }

const KEEP = 15;
const USE = 5;

/** Estimates the server clock from ping/pong round trips (NTP-style). */
export class ClockSync {
  private samples: Sample[] = [];
  /** Samples from before a sleep: still usable until fresh ones arrive. */
  private stale: Sample[] = [];
  private timer: unknown = null;
  private interval = 0;

  constructor(
    private conn: { send(msg: object): unknown },
    private now: () => number = () => Date.now(),
    private setIntervalFn: (fn: () => void, ms: number) => unknown = (fn, ms) => setInterval(fn, ms),
    private clearIntervalFn: (id: unknown) => void = (id) => clearInterval(id as ReturnType<typeof setInterval>),
  ) {}

  ping() {
    this.conn.send({ type: 'ping', t0: this.now() });
  }

  start(intervalMs: number) {
    this.stop();
    this.interval = intervalMs;
    this.ping();
    this.timer = this.setIntervalFn(() => this.ping(), intervalMs);
  }

  setInterval(ms: number) {
    if (ms !== this.interval) this.start(ms);
  }

  stop() {
    if (this.timer !== null) this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  handlePong(msg: { t0: number; t1: number }) {
    const t2 = this.now();
    const rtt = t2 - msg.t0;
    if (rtt < 0) return;
    this.samples.push({ rtt, offset: msg.t1 + rtt / 2 - t2 });
    if (this.samples.length > KEEP) this.samples.shift();
  }

  /**
   * After waking from sleep: prefer fresh samples as soon as one arrives, but keep the old
   * offset usable so taps still work (and queue) if the network is down on wake.
   */
  markStale() {
    if (this.samples.length) this.stale = this.samples;
    this.samples = [];
  }

  synced(): boolean {
    return this.samples.length >= 3 || this.stale.length >= 3;
  }

  private source(): Sample[] {
    return this.samples.length ? this.samples : this.stale;
  }

  offset(): number {
    const source = this.source();
    if (!source.length) return 0;
    const best = [...source].sort((a, b) => a.rtt - b.rtt).slice(0, USE).map((s) => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(best.length / 2);
    return Math.round(best.length % 2 ? best[mid]! : (best[mid - 1]! + best[mid]!) / 2);
  }

  serverNow(): number {
    return this.now() + this.offset();
  }
}
