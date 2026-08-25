import type { PortEvent, PortRequest, PortResponse } from '@shared/protocol/port';

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error & { code?: string }) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let port: MessagePort | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

let resolveReady!: () => void;
export const ready = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

function rejectAllPending(message: string): void {
  for (const [id, req] of pending) {
    if (req.timer) clearTimeout(req.timer);
    req.reject(new Error(message));
    pending.delete(id);
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { __kira?: string } | undefined;
  if (data?.__kira !== 'port') return;
  port?.close();
  const [newPort] = event.ports;
  if (!newPort) return;
  // A renderer reload or an engine restart re-attaches a fresh port; anything still pending on
  // the old one will never answer.
  rejectAllPending('engine port was replaced before this request answered');
  port = newPort;
  port.onmessage = (portEvent: MessageEvent) =>
    handleMessage(portEvent.data as PortResponse | PortEvent);
  resolveReady();
});

function handleMessage(message: PortResponse | PortEvent): void {
  if (message.kind === 'evt') {
    for (const cb of eventListeners.get(message.topic) ?? []) cb(message.payload);
    return;
  }
  const req = pending.get(message.id);
  if (!req) return;
  pending.delete(message.id);
  if (req.timer) clearTimeout(req.timer);
  if (message.ok) {
    req.resolve(message.payload);
  } else {
    const err: Error & { code?: string } = new Error(message.error.message);
    err.code = message.error.code;
    req.reject(err);
  }
}

export function onPortEvent(topic: string, cb: (payload: unknown) => void): () => void {
  let set = eventListeners.get(topic);
  if (!set) {
    set = new Set();
    eventListeners.set(topic, set);
  }
  set.add(cb);
  return () => set?.delete(cb);
}

/**
 * `timeoutMs: null` means no client-side timeout (D25) — cancellation is the only escape hatch
 * for a data op, matching §5.1's rule that a stop button, never a timeout, is what ends a
 * still-running server query.
 */
export function request(
  op: string,
  payload: unknown = null,
  opts?: { timeoutMs?: number | null },
): Promise<unknown> {
  if (!port) return Promise.reject(new Error('engine port not attached yet'));
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            pending.delete(id);
            reject(new Error(`engine request "${op}" timed out`));
          }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const req: PortRequest = { kind: 'req', id, op, payload };
    port?.postMessage(req);
  });
}
