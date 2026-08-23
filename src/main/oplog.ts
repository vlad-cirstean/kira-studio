import type { OpKind, OpRecord } from '../shared/domain/ops';
import { ENGINE_EVENT, opEndEventSchema, opStartEventSchema } from '../shared/protocol/engine-ops';
import type { EngineHost } from './engine-host';
import type { KiraDb } from './storage/db';
import { appendOp, finishOp, pruneOps } from './storage/repos/ops';

interface InFlightOp {
  connectionId: string | null;
  tabId: string | null;
  kind: OpKind;
  startedAt: string;
}

// D11: bounds the table at HARD_CAP_ROWS + PRUNE_EVERY_OPS instead of only at the next launch —
// a counter is deterministic and testable, and adds no timer of its own to leak.
const PRUNE_EVERY_OPS = 500;

// Pure orchestration — subscribes to the engine's op:start/op:end events, calls repos/ops.ts
// for the actual writes, forwards kira:op:update, and prunes retention once at startup (D11:
// and again every PRUNE_EVERY_OPS completed ops). Never touches Drizzle/op_log directly (that's
// repos/ops.ts's job).
export function wireOplog(
  engineHost: EngineHost,
  db: KiraDb,
  broadcast: (record: OpRecord) => void,
  retentionDays: number,
): void {
  void pruneOps(db, retentionDays);

  const inFlight = new Map<string, InFlightOp>();
  let completedSincePrune = 0;

  engineHost.on(ENGINE_EVENT.opStart, async (payload) => {
    const parsed = opStartEventSchema.safeParse(payload);
    if (!parsed.success) return;
    const evt = parsed.data;
    const record: InFlightOp = {
      connectionId: evt.connectionId,
      tabId: evt.tabId,
      kind: evt.kind,
      startedAt: evt.startedAt,
    };
    inFlight.set(evt.opId, record);
    await appendOp(db, {
      id: evt.opId,
      connectionId: record.connectionId,
      tabId: record.tabId,
      kind: record.kind,
      startedAt: record.startedAt,
    });
    broadcast({
      id: evt.opId,
      connectionId: record.connectionId,
      tabId: record.tabId,
      startedAt: record.startedAt,
      durationMs: null,
      kind: record.kind,
      status: 'running',
      rows: null,
      command: null,
      error: null,
    });
  });

  engineHost.on(ENGINE_EVENT.opEnd, async (payload) => {
    const parsed = opEndEventSchema.safeParse(payload);
    if (!parsed.success) return;
    const evt = parsed.data;
    await finishOp(db, evt.opId, {
      status: evt.status,
      durationMs: evt.durationMs,
      rows: evt.rows,
      command: evt.command,
      error: evt.error,
    });
    const started = inFlight.get(evt.opId);
    inFlight.delete(evt.opId);
    broadcast({
      id: evt.opId,
      connectionId: started?.connectionId ?? null,
      tabId: started?.tabId ?? null,
      startedAt: started?.startedAt ?? new Date().toISOString(),
      durationMs: evt.durationMs,
      kind: started?.kind ?? 'test',
      status: evt.status,
      rows: evt.rows,
      command: evt.command,
      error: evt.error,
    });
    completedSincePrune++;
    if (completedSincePrune >= PRUNE_EVERY_OPS) {
      completedSincePrune = 0;
      void pruneOps(db, retentionDays);
    }
  });

  // D10: the engine host has already rejected every pending IPC call by the time it fires
  // `engine:down` (engine-host.ts's `exit` handler) — this finishes the op-log rows for whatever
  // was still `running` at that moment with the same message, and drops them from `inFlight` so
  // a crash mid-session cannot grow the map without bound.
  engineHost.on('engine:down', () => {
    const abandoned = [...inFlight.entries()];
    inFlight.clear();
    for (const [opId, record] of abandoned) {
      void finishOp(db, opId, {
        status: 'error',
        durationMs: Date.now() - Date.parse(record.startedAt),
        rows: null,
        command: null,
        error: 'engine process exited',
      });
    }
  });
}
