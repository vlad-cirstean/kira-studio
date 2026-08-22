import type {
  CountRequest,
  CountResult,
  ReadRequest,
  ReadResult,
} from '@shared/data';
import type { PortEvent, PortRequest, PortResponse } from '@shared/port';
import { PORT_OP } from '@shared/port';
import { assertTabularPage } from '../workbench/state/page';

// The renderer↔engine bulk channel (P2 D1). Result pages and cache stats travel here, skipping main
// entirely; control traffic (tabs, saved filters, settings, cancel) stays on ipcRenderer.invoke.

const CONTROL_TIMEOUT_MS = 30_000;
const DATA_TIMEOUT_MS = 120_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let port: MessagePort | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

// Event subscribers keyed by topic. `PortEvent` (declared since P0, dead until P2) becomes real
// here: inbound frames with `kind: 'evt'` dispatch to these.
const subscribers = new Map<string, Set<(payload: unknown) => void>>();

let resolveReady!: () => void;
export const ready = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { __kira?: string } | undefined;
  if (data?.__kira !== 'port') return;
  port?.close();
  const [newPort] = event.ports;
  if (!newPort) return;
  port = newPort;
  port.onmessage = (portEvent: MessageEvent) => handleMessage(portEvent.data as unknown);
  resolveReady();
});

function handleMessage(frame: unknown): void {
  const data = frame as { kind?: string };
  if (data?.kind === 'evt') {
    const evt = data as PortEvent;
    const set = subscribers.get(evt.topic);
    if (set) for (const cb of set) cb(evt.payload);
    return;
  }
  if (data?.kind !== 'res') {
    // One unknown frame is a bug worth one log line, not a crash loop.
    console.error(`[kira:port] dropping unknown frame`, frame);
    return;
  }
  const response = data as PortResponse;
  const req = pending.get(response.id);
  if (!req) return;
  pending.delete(response.id);
  clearTimeout(req.timer);
  if (response.ok) {
    req.resolve(response.payload);
  } else {
    req.reject(new Error(response.error.message));
  }
}

export function subscribe(topic: string, handler: (payload: unknown) => void): () => void {
  let set = subscribers.get(topic);
  if (!set) {
    set = new Set();
    subscribers.set(topic, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function request(op: string, payload: unknown = null, timeoutMs = CONTROL_TIMEOUT_MS): Promise<unknown> {
  if (!port) return Promise.reject(new Error('engine port not attached yet'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`engine request "${op}" timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const req: PortRequest = { kind: 'req', id, op, payload };
    port?.postMessage(req);
  });
}

// Typed data-path wrappers. The read timeout is 120 s because `count(*)` on a 200 M-row table can
// legitimately take minutes-scale on a slow machine; the real bound is the user's stop button, not
// the timeout (D9).
export async function readPage(req: ReadRequest): Promise<ReadResult> {
  await ready;
  const payload = (await request(PORT_OP.read, req, DATA_TIMEOUT_MS)) as ReadResult;
  if (payload.delivered) {
    // The one place the wire format is validated structurally (§3.1): the delivered page carries
    // megabytes of typed arrays and cannot afford a Zod parse per page.
    return { delivered: true, page: assertTabularPage(payload.page) };
  }
  return payload;
}

export async function countRows(req: CountRequest): Promise<CountResult> {
  await ready;
  return (await request(PORT_OP.count, req, DATA_TIMEOUT_MS)) as CountResult;
}

export async function cacheStatsRequest(): Promise<unknown> {
  await ready;
  return request(PORT_OP.cacheStats, null);
}

export async function cacheClear(): Promise<void> {
  await ready;
  await request(PORT_OP.cacheClear, null);
}
