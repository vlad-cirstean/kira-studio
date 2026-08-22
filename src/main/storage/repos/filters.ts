import { z } from 'zod';
import { log } from '../../log';
import type { Db } from '../db';

const filterNodeKindSchema = z.enum(['database', 'schema', 'table']);
const filterActionSchema = z.enum(['hide', 'show']);

export interface ConnectionFilter {
  id: string;
  connectionId: string;
  nodeKind: 'database' | 'schema' | 'table';
  pattern: string;
  isRegex: boolean;
  action: 'hide' | 'show';
}

export interface ConnectionFilterInput {
  nodeKind: 'database' | 'schema' | 'table';
  pattern: string;
  isRegex: boolean;
  action: 'hide' | 'show';
}

const filterRowSchema = z
  .object({
    id: z.string(),
    connection_id: z.string(),
    node_kind: filterNodeKindSchema,
    pattern: z.string(),
    is_regex: z.union([z.literal(0), z.literal(1)]),
    action: filterActionSchema,
  })
  .transform(
    (row): ConnectionFilter => ({
      id: row.id,
      connectionId: row.connection_id,
      nodeKind: row.node_kind,
      pattern: row.pattern,
      isRegex: row.is_regex === 1,
      action: row.action,
    }),
  );

export function listFilters(db: Db, connectionId: string): ConnectionFilter[] {
  const rows = db.all(
    'SELECT id, connection_id, node_kind, pattern, is_regex, action FROM connection_filters ' +
      'WHERE connection_id = ? ORDER BY rowid',
    [connectionId],
  );
  const out: ConnectionFilter[] = [];
  for (const row of rows) {
    const parsed = filterRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      log('warn', 'storage/filters', `dropping unparseable filter row: ${parsed.error.message}`);
    }
  }
  return out;
}

// Delete-all + insert, one transaction: the dialog edits a whole list and saves it, and the
// set is small enough that a per-row diff would add complexity for no benefit.
export function replaceFilters(
  db: Db,
  connectionId: string,
  inputs: ConnectionFilterInput[],
): ConnectionFilter[] {
  db.transaction(() => {
    db.run('DELETE FROM connection_filters WHERE connection_id = ?', [connectionId]);
    for (const input of inputs) {
      db.run(
        'INSERT INTO connection_filters (id, connection_id, node_kind, pattern, is_regex, action) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
        [
          crypto.randomUUID(),
          connectionId,
          input.nodeKind,
          input.pattern,
          input.isRegex ? 1 : 0,
          input.action,
        ],
      );
    }
  });
  return listFilters(db, connectionId);
}
