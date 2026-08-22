import { type OpRecord, opRecordSchema } from '../../../shared/domain/ops';
import { log } from '../../log';
import type { Db } from '../db';

const RETENTION_DAYS = 30;
const HARD_CAP_ROWS = 20_000;

export interface AppendOpInput {
  id: string;
  connectionId: string | null;
  tabId: string | null;
  kind: OpRecord['kind'];
  startedAt: string;
}

export function appendOp(db: Db, input: AppendOpInput): void {
  db.run(
    `INSERT INTO op_log (id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error)
     VALUES (?, ?, ?, ?, NULL, ?, 'running', NULL, NULL, NULL)`,
    [input.id, input.connectionId, input.tabId, input.startedAt, input.kind],
  );
}

export interface FinishOpPatch {
  status: 'ok' | 'error' | 'cancelled';
  durationMs: number;
  rows: number | null;
  command: string | null;
  error: string | null;
}

export function finishOp(db: Db, id: string, patch: FinishOpPatch): void {
  db.run(
    'UPDATE op_log SET status = ?, duration_ms = ?, rows = ?, command = ?, error = ? WHERE id = ?',
    [patch.status, patch.durationMs, patch.rows, patch.command, patch.error, id],
  );
}

export function recentOps(db: Db, limit: number): OpRecord[] {
  const rows = db.all('SELECT * FROM op_log ORDER BY started_at DESC LIMIT ?', [limit]);
  const out: OpRecord[] = [];
  for (const row of rows) {
    const candidate = {
      id: row.id,
      connectionId: row.connection_id,
      tabId: row.tab_id,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
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

export function pruneOps(db: Db): void {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.run('DELETE FROM op_log WHERE started_at < ?', [cutoff]);
  db.run(
    `DELETE FROM op_log WHERE id NOT IN (
       SELECT id FROM op_log ORDER BY started_at DESC LIMIT ?
     )`,
    [HARD_CAP_ROWS],
  );
}
