import type { OpKind } from '@shared/domain/ops';
import { ENGINE_EVENT } from '@shared/protocol/engine-ops';
import type { Adapter, OpCtx, Progress } from '../adapters/adapter';
import { AdapterError } from '../adapters/errors';

export interface RunOpCtx extends OpCtx {
  /** children() sets this to the node count, describe() to the column count (§4c). */
  setRows(n: number): void;
}

interface RunningOp {
  controller: AbortController;
  connectionId: string | null;
}

const running = new Map<string, RunningOp>();

let emitEvent: (topic: string, payload: unknown) => void = () => {};
let lookupAdapter: (connectionId: string) => Adapter | undefined = () => undefined;

// control.ts calls this once at startup — kept as an injected callback rather than a static
// import of control.ts so the two modules do not form an import cycle.
export function wireScheduler(deps: {
  emit: (topic: string, payload: unknown) => void;
  getAdapter: (connectionId: string) => Adapter | undefined;
}): void {
  emitEvent = deps.emit;
  lookupAdapter = deps.getAdapter;
}

export async function runOp<T>(
  spec: { connectionId: string | null; kind: OpKind; opId?: string; tabId?: string | null },
  fn: (ctx: RunOpCtx) => Promise<T>,
): Promise<{ opId: string; value: T }> {
  const opId = spec.opId ?? crypto.randomUUID();
  // A duplicate id would corrupt the op log's primary key and let the stop button cancel the
  // wrong query (D2) — reject it before op:start is even emitted.
  if (running.has(opId)) {
    throw new AdapterError('E_QUERY', `duplicate operation id: ${opId}`);
  }
  const tabId = spec.tabId ?? null;
  const controller = new AbortController();
  running.set(opId, { controller, connectionId: spec.connectionId });

  const startedAt = new Date().toISOString();
  emitEvent(ENGINE_EVENT.opStart, {
    opId,
    connectionId: spec.connectionId,
    tabId,
    kind: spec.kind,
    startedAt,
  });

  let command: string | null = null;
  let rows: number | null = null;
  const start = performance.now();

  const ctx: RunOpCtx = {
    opId,
    signal: controller.signal,
    setCommand(text: string) {
      command = text;
    },
    setRows(n: number) {
      rows = n;
    },
    onProgress(_p: Progress) {
      // No P1 consumer of progress events yet — the hook exists on OpCtx for adapters that
      // report it; the operations panel has nothing to render it into until P2/P3.
    },
  };

  try {
    const value = await fn(ctx);
    const durationMs = Math.round(performance.now() - start);
    emitEvent(ENGINE_EVENT.opEnd, { opId, status: 'ok', durationMs, rows, command, error: null });
    return { opId, value };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const status = controller.signal.aborted ? 'cancelled' : 'error';
    const message = err instanceof Error ? err.message : String(err);
    emitEvent(ENGINE_EVENT.opEnd, { opId, status, durationMs, rows, command, error: message });
    throw err;
  } finally {
    running.delete(opId);
  }
}

// Both, in this order: the abort unblocks the local await immediately; the adapter call is
// what actually kills the server-side work (§5.1: cancellation is always forwarded).
export async function cancelOp(opId: string): Promise<boolean> {
  const op = running.get(opId);
  if (!op) return false;
  op.controller.abort();
  if (op.connectionId) {
    const adapter = lookupAdapter(op.connectionId);
    if (adapter) {
      try {
        await adapter.cancel(opId);
      } catch {
        // Best-effort — the local abort has already unblocked the awaiting call regardless.
      }
    }
  }
  return true;
}
