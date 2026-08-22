import type { PortRequest, PortResponse } from '@shared/port';

const TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let port: MessagePort | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

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
  port.onmessage = (portEvent: MessageEvent) => handleMessage(portEvent.data as PortResponse);
  resolveReady();
});

function handleMessage(response: PortResponse): void {
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

export function request(op: string, payload: unknown = null): Promise<unknown> {
  if (!port) return Promise.reject(new Error('engine port not attached yet'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`engine request "${op}" timed out`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const req: PortRequest = { kind: 'req', id, op, payload };
    port?.postMessage(req);
  });
}
