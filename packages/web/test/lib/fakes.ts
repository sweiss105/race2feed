/** Minimal stand-in for the browser WebSocket, driven by tests. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: any[] = [];
  private listeners: Record<string, ((e: any) => void)[]> = {};
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (e: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.emitClose(1000);
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  message(msg: unknown) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
  emitClose(code: number) {
    this.readyState = 3;
    this.emit('close', { code });
  }
  private emit(type: string, e: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
  static reset() {
    FakeWebSocket.instances = [];
  }
  static last() {
    return FakeWebSocket.instances.at(-1)!;
  }
}

export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}
