import { randomUUID } from 'node:crypto';
import { ENGINE_EVENT } from '../shared/engine-ops';
import type { OpKind } from '../shared/ops';
import type { OpCtx } from './adapters/adapter';
import { AdapterError } from './adapters/errors';

// runOp wraps every server-touching adapter call. It generates the opId, owns the AbortController
// (registered for cancelOp), and emits op:start/op:end to main. `rows` stays null unless the
// handler sets it via `ctx.setRows` — children sets it to the node count, describe to the column
// count, so the operations panel has something meaningful in the column.

interface ActiveOp {
  controller: AbortController;
  connectionId: string | null;
  tabId: string | null;
}

const active = new Map<string, ActiveOp>();

export function emitEvent(topic: string, payload: unknown): void {
  // process.parentPort only exists inside the Electron utility process; the guard keeps ops.ts
  // importable by a plain Bun process (tests/db) where runOp is driven directly.
  const parentPort = (process as unknown as { parentPort?: { postMessage(m: unknown): void } })
    .parentPort;
  parentPort?.postMessage({ kind: 'evt', topic, payload });
}

export interface OpResult<T> {
  opId: string;
  value: T;
}

type OpFn<T> = (ctx: OpCtx & { setRows(n: number): void }) => Promise<T>;

export async function runOp<T>(
  spec: { connectionId: string | null; kind: OpKind; tabId?: string | null },
  fn: OpFn<T>,
): Promise<OpResult<T>> {
  const opId = randomUUID();
  const controller = new AbortController();
  let rows: number | null = null;
  let command: string | null = null;
  const tabId = spec.tabId ?? null;

  active.set(opId, { controller, connectionId: spec.connectionId, tabId });
  emitEvent(ENGINE_EVENT.opStart, {
    opId,
    connectionId: spec.connectionId,
    tabId,
    kind: spec.kind,
    startedAt: new Date().toISOString(),
  });

  const start = Date.now();
  const ctx: OpCtx & { setRows(n: number): void } = {
    opId,
    signal: controller.signal,
    setCommand: (text: string) => {
      command = text;
    },
    setRows: (n: number) => {
      rows = n;
    },
  };

  try {
    const value = await fn(ctx);
    emitEvent(ENGINE_EVENT.opEnd, {
      opId,
      status: 'ok',
      durationMs: Date.now() - start,
      rows,
      command,
      error: null,
    });
    return { opId, value };
  } catch (err) {
    const cancelled =
      controller.signal.aborted || (err instanceof AdapterError && err.code === 'E_CANCELLED');
    emitEvent(ENGINE_EVENT.opEnd, {
      opId,
      status: cancelled ? 'cancelled' : 'error',
      durationMs: Date.now() - start,
      rows,
      command,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    active.delete(opId);
  }
}

// Aborts the local controller (which unblocks the awaiting adapter call) and returns the owning
// connection id so the caller can forward the cancel to the server. Deregistration happens in
// runOp's `finally`.
export function abortOp(opId: string): { connectionId: string | null } | null {
  const entry = active.get(opId);
  if (!entry) return null;
  entry.controller.abort();
  return { connectionId: entry.connectionId };
}
