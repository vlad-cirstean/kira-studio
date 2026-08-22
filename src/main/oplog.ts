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

// Pure orchestration — subscribes to the engine's op:start/op:end events, calls repos/ops.ts
// for the actual writes, forwards kira:op:update, and prunes retention once at startup. Never
// touches Drizzle/op_log directly (that's repos/ops.ts's job).
export function wireOplog(
  engineHost: EngineHost,
  db: KiraDb,
  broadcast: (record: OpRecord) => void,
): void {
  void pruneOps(db);

  const inFlight = new Map<string, InFlightOp>();

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
  });
}
