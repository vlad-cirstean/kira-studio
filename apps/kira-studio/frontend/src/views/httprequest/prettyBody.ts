import PrettyWorker from './prettyBody.worker?worker';
import type { PrettyRequest, PrettyResult } from './prettyBodyCore';

type Pending = { resolve: (r: PrettyResult) => void; reject: (e: unknown) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function failAll(reason: unknown): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(reason);
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new PrettyWorker();
  w.addEventListener('message', (e: MessageEvent<PrettyResult & { id: number }>) => {
    const { id, ...result } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.resolve(result);
  });
  // Drop the singleton so the next call recreates it (same reject-then-retry shape as loadMonaco).
  w.addEventListener('error', (e) => failAll(e));
  worker = w;
  return w;
}

/** Formats off the main thread. Rejects if the worker fails; callers fall back to `formatBody`. */
export function formatBodyInWorker(body: string, wantText: boolean): Promise<PrettyResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      const req: PrettyRequest = { id, body, wantText };
      ensureWorker().postMessage(req);
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}
