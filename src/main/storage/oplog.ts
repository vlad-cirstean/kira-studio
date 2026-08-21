import { desc, eq, lt, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { type OpRecord, opKindSchema, opStatusSchema } from '../../shared/ops';
import { log } from '../log';
import type { Db } from './db';
import { opLog } from './schema';

// `op_log` persistence (D19). Written by main from the engine's op:start/op:end events; retention
// pruning runs once at startup.

const RETENTION_DAYS = 30;
const HARD_CAP = 20_000;

const opLogRowSchema = z
  .object({
    id: z.string(),
    connectionId: z.string().nullable(),
    tabId: z.string().nullable(),
    startedAt: z.string(),
    durationMs: z.number().nullable(),
    kind: opKindSchema,
    status: opStatusSchema,
    rows: z.number().nullable(),
    command: z.string().nullable(),
    error: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    connectionId: r.connectionId,
    tabId: r.tabId,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    kind: r.kind,
    status: r.status,
    rows: r.rows,
    command: r.command,
    error: r.error,
  }));

export async function appendOp(db: Db, record: OpRecord): Promise<void> {
  await db.insert(opLog).values({
    id: record.id,
    connectionId: record.connectionId,
    tabId: record.tabId,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    kind: record.kind,
    status: record.status,
    rows: record.rows,
    command: record.command,
    error: record.error,
  });
}

export interface OpFinishPatch {
  status: 'ok' | 'error' | 'cancelled';
  durationMs: number;
  rows: number | null;
  command: string | null;
  error: string | null;
}

export async function finishOp(db: Db, id: string, patch: OpFinishPatch): Promise<void> {
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

export async function recentOps(db: Db, limit: number): Promise<OpRecord[]> {
  const rows = await db.select().from(opLog).orderBy(desc(opLog.startedAt)).limit(limit);
  const out: OpRecord[] = [];
  for (const row of rows) {
    const parsed = opLogRowSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else log('warn', 'oplog', `skipping unparseable op_log row: ${JSON.stringify(row)}`);
  }
  return out;
}

export async function pruneOps(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.delete(opLog).where(lt(opLog.startedAt, cutoff));
  await db
    .delete(opLog)
    .where(
      notInArray(
        opLog.id,
        db.select({ id: opLog.id }).from(opLog).orderBy(desc(opLog.startedAt)).limit(HARD_CAP),
      ),
    );
}
