import { desc, eq, lt, notInArray } from 'drizzle-orm';
import { type OpRecord, opRecordSchema } from '../../../shared/domain/ops';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { opLog } from '../schema/ops';

const HARD_CAP_ROWS = 20_000;

export interface AppendOpInput {
  id: string;
  connectionId: string | null;
  tabId: string | null;
  kind: OpRecord['kind'];
  startedAt: string;
}

export async function appendOp(db: KiraDb, input: AppendOpInput): Promise<void> {
  await db.insert(opLog).values({
    id: input.id,
    connectionId: input.connectionId,
    tabId: input.tabId,
    startedAt: input.startedAt,
    durationMs: null,
    kind: input.kind,
    status: 'running',
    rows: null,
    command: null,
    error: null,
  });
}

export interface FinishOpPatch {
  status: 'ok' | 'error' | 'cancelled';
  durationMs: number;
  rows: number | null;
  command: string | null;
  error: string | null;
}

export async function finishOp(db: KiraDb, id: string, patch: FinishOpPatch): Promise<void> {
  await db
    .update(opLog)
    .set({
      status: patch.status,
      durationMs: patch.durationMs,
      rows: patch.rows,
      command: patch.command,
      error: patch.error,
    })
    .where(eq(opLog.id, id));
}

export async function recentOps(db: KiraDb, limit: number): Promise<OpRecord[]> {
  const rows = await db.select().from(opLog).orderBy(desc(opLog.startedAt)).limit(limit);
  const out: OpRecord[] = [];
  for (const row of rows) {
    const candidate = {
      id: row.id,
      connectionId: row.connectionId,
      tabId: row.tabId,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      kind: row.kind,
      status: row.status,
      rows: row.rows,
      command: row.command,
      error: row.error,
    };
    const parsed = opRecordSchema.safeParse(candidate);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      log('warn', 'storage/ops', `dropping unparseable op_log row: ${parsed.error.message}`);
    }
  }
  return out;
}

export async function pruneOps(db: KiraDb, retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  await db.delete(opLog).where(lt(opLog.startedAt, cutoff));

  const keep = await db
    .select({ id: opLog.id })
    .from(opLog)
    .orderBy(desc(opLog.startedAt))
    .limit(HARD_CAP_ROWS);
  const keepIds = keep.map((r) => r.id);
  if (keepIds.length > 0) {
    await db.delete(opLog).where(notInArray(opLog.id, keepIds));
  }
}
