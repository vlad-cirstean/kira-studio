import { z } from 'zod';
import {
  type ConnectionInput,
  type ConnectionSummary,
  connectionColorSchema,
  connectionKindSchema,
  connectionModeSchema,
} from '../../../shared/domain/connection';
import { log } from '../../log';
import type { Db } from '../db';

// The fields the repo layer accepts on write. `password` is deliberately excluded from this
// type — these functions never select, insert, or update that column; the caller (Step 6a's
// connections.ts orchestration) pairs every call here with a `SecretStore` call.
export type ConnectionFields = Omit<ConnectionInput, 'password'>;

const SELECT_COLUMNS =
  'id, name, kind, color, mode, read_only, host, port, database, username, uri, ' +
  'options_json, created_at, updated_at, sort_order';

const connectionRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: connectionKindSchema,
    color: connectionColorSchema,
    mode: connectionModeSchema,
    read_only: z.union([z.literal(0), z.literal(1)]),
    host: z.string().nullable(),
    port: z.number().nullable(),
    database: z.string().nullable(),
    username: z.string().nullable(),
    uri: z.string().nullable(),
    options_json: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    sort_order: z.number(),
  })
  .transform(
    (row): ConnectionSummary => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      mode: row.mode,
      readOnly: row.read_only === 1,
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      uri: row.uri,
      options: row.options_json ? (JSON.parse(row.options_json) as Record<string, unknown>) : {},
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

// A hand-mangled row must not make the whole app unlaunchable (unlike settings/layout, where a
// bad row means the app has no config at all) — log and skip it instead of throwing.
function parseRow(row: Record<string, unknown>): ConnectionSummary | null {
  const result = connectionRowSchema.safeParse(row);
  if (!result.success) {
    log(
      'warn',
      'storage/connections',
      `dropping unparseable connection row: ${result.error.message}`,
    );
    return null;
  }
  return result.data;
}

export function listConnections(db: Db): ConnectionSummary[] {
  const rows = db.all(`SELECT ${SELECT_COLUMNS} FROM connections ORDER BY sort_order, name`);
  const out: ConnectionSummary[] = [];
  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function getConnection(db: Db, id: string): ConnectionSummary | null {
  const row = db.get(`SELECT ${SELECT_COLUMNS} FROM connections WHERE id = ?`, [id]);
  return row ? parseRow(row) : null;
}

function nextSortOrder(db: Db): number {
  const row = db.get('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM connections') as
    | { maxOrder: number }
    | undefined;
  return (row?.maxOrder ?? -1) + 1;
}

export interface NewConnectionRow {
  id: string;
  fields: ConnectionFields;
  createdAt: string;
}

export function insertConnection(db: Db, row: NewConnectionRow): ConnectionSummary {
  const sortOrder = nextSortOrder(db);
  db.run(
    `INSERT INTO connections
       (id, name, kind, color, mode, read_only, host, port, database, username, uri,
        options_json, created_at, updated_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.fields.name,
      row.fields.kind,
      row.fields.color,
      row.fields.mode,
      row.fields.readOnly ? 1 : 0,
      row.fields.host,
      row.fields.port,
      row.fields.database,
      row.fields.username,
      row.fields.uri,
      JSON.stringify(row.fields.options),
      row.createdAt,
      row.createdAt,
      sortOrder,
    ],
  );
  const created = getConnection(db, row.id);
  if (!created) throw new Error(`insertConnection: row ${row.id} not readable after insert`);
  return created;
}

export function updateConnection(
  db: Db,
  id: string,
  fields: ConnectionFields,
  updatedAt: string,
): ConnectionSummary {
  db.run(
    `UPDATE connections
        SET name = ?, kind = ?, color = ?, mode = ?, read_only = ?, host = ?, port = ?,
            database = ?, username = ?, uri = ?, options_json = ?, updated_at = ?
      WHERE id = ?`,
    [
      fields.name,
      fields.kind,
      fields.color,
      fields.mode,
      fields.readOnly ? 1 : 0,
      fields.host,
      fields.port,
      fields.database,
      fields.username,
      fields.uri,
      JSON.stringify(fields.options),
      updatedAt,
      id,
    ],
  );
  const updated = getConnection(db, id);
  if (!updated) throw new Error(`updateConnection: row ${id} not found`);
  return updated;
}

export function deleteConnection(db: Db, id: string): void {
  db.run('DELETE FROM connections WHERE id = ?', [id]);
}

export function reorderConnections(db: Db, ids: string[]): ConnectionSummary[] {
  db.transaction(() => {
    ids.forEach((id, index) => {
      db.run('UPDATE connections SET sort_order = ? WHERE id = ?', [index, id]);
    });
  });
  return listConnections(db);
}
