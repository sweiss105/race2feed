import { nextDelay } from './backoff';
import type { Ack, ServerMessage } from './types';

export type LiveStatus = 'connecting' | 'open' | 'offline' | 'signed-out';

export interface LiveOptions {
  url: string;
  onMessage(msg: ServerMessage): void;
  onStatus(status: LiveStatus): void;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  /** Authenticated pages: resolves false when the user is signed out. */
  checkAuth?: () => Promise<boolean>;
}

const STABLE_AFTER_MS = 10_000;

/** ws(s)://host/path for the current page. */
export function wsUrl(path: string): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}

/** A WebSocket that reconnects with jittered backoff and pairs commands with their acks. */
export class LiveConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, { resolve(a: Ack): void; reject(reason: string): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private opts: LiveOptions) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.ws?.close();
    this.ws = null;
  }

  get isOpen() {
    return this.ws?.readyState === 1;
  }

  send(msg: object): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  command(cmd: object, timeoutMs = 10_000): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      if (!this.send({ type: 'cmd', id, cmd })) return reject('offline');
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject('timeout');
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private connect() {
    if (this.stopped) return;
    this.opts.onStatus('connecting');
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new Impl(this.opts.url);
    this.ws = ws;
    let opened = false;
    ws.addEventListener('open', () => {
      opened = true;
      this.opts.onStatus('open');
      this.stableTimer = setTimeout(() => { this.attempt = 0; }, STABLE_AFTER_MS);
    });
    ws.addEventListener('message', (e: MessageEvent) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      if (msg.type === 'ack') {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
      }
      this.opts.onMessage(msg);
    });
    ws.addEventListener('close', (e: CloseEvent) => void this.onClose(ws, e.code, opened));
  }

  private async onClose(ws: WebSocket, code: number, opened: boolean) {
    if (ws !== this.ws) return;
    if (this.stableTimer) clearTimeout(this.stableTimer);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject('offline');
      this.pending.delete(id);
    }
    if (this.stopped) return;
    if (code === 4401) return this.signOut();
    if (!opened && this.opts.checkAuth && !(await this.opts.checkAuth().catch(() => true))) return this.signOut();
    this.opts.onStatus('offline');
    const delay = nextDelay(this.attempt++, this.opts.random ?? Math.random);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private signOut() {
    this.stopped = true;
    this.opts.onStatus('signed-out');
  }
}
