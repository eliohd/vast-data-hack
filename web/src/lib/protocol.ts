// Messages exchanged over the /ws/live WebSocket. Mirrors server/app/core/protocol.py —
// change both together. REST types are generated separately (see src/lib/api).

/** A bounding box in normalised [0, 1] image coordinates. */
export interface Box {
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClientFrame {
  type: 'frame';
  seq: number;
  /** Client clock (ms since epoch) when the frame was captured. */
  capturedAt: number;
  /** JPEG as a data URL: `data:image/jpeg;base64,...` */
  image: string;
  width: number;
  height: number;
  /** Optional free-text question the user is asking about this frame. */
  prompt?: string;
}

export interface ClientPing {
  type: 'ping';
  sentAt: number;
}

export type ClientMessage = ClientFrame | ClientPing;

export interface ServerHello {
  type: 'hello';
  sessionId: string;
  /** Which analyser the server is running, e.g. "cosmos" or "stub". */
  analyser: string;
}

export interface ServerResult {
  type: 'result';
  seq: number;
  capturedAt: number;
  /** Server-side processing time for this frame. */
  processingMs: number;
  summary: string;
  boxes: Box[];
  /** Free-form structured output from the analyser (JSON from the model). */
  data: Record<string, unknown>;
}

export interface ServerPong {
  type: 'pong';
  sentAt: number;
}

export interface ServerError {
  type: 'error';
  seq?: number;
  message: string;
}

export type ServerMessage = ServerHello | ServerResult | ServerPong | ServerError;

const SERVER_TYPES = new Set<ServerMessage['type']>(['hello', 'result', 'pong', 'error']);

/** Parses a raw WebSocket payload, returning null for anything that isn't a known message. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !SERVER_TYPES.has(type as ServerMessage['type'])) return null;
  return value as ServerMessage;
}
