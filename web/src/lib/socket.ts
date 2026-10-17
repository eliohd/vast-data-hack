import { parseServerMessage, type ClientMessage, type ServerMessage } from './protocol';

/** Exponential backoff with a cap: 0.5s, 1s, 2s, 4s … up to `maxMs`. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

/** Same-origin WebSocket URL for a path, matching the page's http/https scheme. */
export function wsUrl(path: string, location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${path}`;
}

export type SocketState = 'connecting' | 'open' | 'closed';

interface Options {
  path: string;
  onMessage: (message: ServerMessage) => void;
  onState: (state: SocketState) => void;
}

/** A WebSocket that reconnects with backoff until `close()` is called. */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  /** True when the socket can take another message without queueing behind a slow upload. */
  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount === 0;
  }

  send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.options.onState('closed');
  }

  private open(): void {
    this.options.onState('connecting');
    const ws = new WebSocket(wsUrl(this.options.path, window.location));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.options.onState('open');
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (message) this.options.onMessage(message);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.options.onState('closed');
      if (this.stopped) return;
      this.timer = setTimeout(() => this.open(), backoffDelay(this.attempt++));
    };
  }
}
