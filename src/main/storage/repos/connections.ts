import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ConnectionInput,
  type ConnectionSummary,
  connectionColorSchema,
  connectionKindSchema,
  connectionModeSchema,
} from '../../../shared/domain/connection';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { connections } from '../schema/connections';

// The fields the repo layer accepts on write. `password` is deliberately excluded from this
// type — these functions never select, insert, or update that column; the caller (Step 6a's
// connections.ts orchestration) pairs every call here with a `SecretStore` call.
export type ConnectionFields = Omit<ConnectionInput, 'password'>;

const SELECT_COLUMNS = {
  id: connections.id,
  name: connections.name,
  kind: connections.kind,
  color: connections.color,
  mode: connections.mode,
  readOnly: connections.readOnly,
  host: connections.host,
  port: connections.port,
  database: connections.database,
  username: connections.username,
  uri: connections.uri,
  optionsJson: connections.optionsJson,
  preconnect: connections.preconnect,
  preconnectSidecar: connections.preconnectSidecar,
  createdAt: connections.createdAt,
  updatedAt: connections.updatedAt,
  sortOrder: connections.sortOrder,
};

const connectionRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: connectionKindSchema,
    color: connectionColorSchema,
    mode: connectionModeSchema,
    readOnly: z.boolean(),
    host: z.string().nullable(),
    port: z.number().nullable(),
    database: z.string().nullable(),
    username: z.string().nullable(),
    uri: z.string().nullable(),
    optionsJson: z.string().nullable(),
    preconnect: z.string().nullable(),
    preconnectSidecar: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    sortOrder: z.number(),
  })
  .transform(
    (row): ConnectionSummary => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      mode: row.mode,
      readOnly: row.readOnly,
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      uri: row.uri,
      options: row.optionsJson ? (JSON.parse(row.optionsJson) as Record<string, unknown>) : {},
      preconnect: row.preconnect,
      preconnectSidecar: row.preconnectSidecar,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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

export async function listConnections(db: KiraDb): Promise<ConnectionSummary[]> {
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(connections)
    .orderBy(asc(connections.sortOrder), asc(connections.name));
  const out: ConnectionSummary[] = [];
  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function getConnection(db: KiraDb, id: string): Promise<ConnectionSummary | null> {
  const rows = await db.select(SELECT_COLUMNS).from(connections).where(eq(connections.id, id));
  const row = rows[0];
  return row ? parseRow(row) : null;
}

async function nextSortOrder(db: KiraDb): Promise<number> {
  const rows = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(${connections.sortOrder}), -1)` })
    .from(connections);
  return (rows[0]?.maxOrder ?? -1) + 1;
}

export interface NewConnectionRow {
  id: string;
  fields: ConnectionFields;
  createdAt: string;
}

export async function insertConnection(
  db: KiraDb,
  row: NewConnectionRow,
): Promise<ConnectionSummary> {
  const sortOrder = await nextSortOrder(db);
  await db.insert(connections).values({
    id: row.id,
    name: row.fields.name,
    kind: row.fields.kind,
    color: row.fields.color,
    mode: row.fields.mode,
    readOnly: row.fields.readOnly,
    host: row.fields.host,
    port: row.fields.port,
    database: row.fields.database,
    username: row.fields.username,
    uri: row.fields.uri,
    optionsJson: JSON.stringify(row.fields.options),
    preconnect: row.fields.preconnect,
    preconnectSidecar: row.fields.preconnectSidecar,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    sortOrder,
  });
  const created = await getConnection(db, row.id);
  if (!created) throw new Error(`insertConnection: row ${row.id} not readable after insert`);
  return created;
}

export async function updateConnection(
  db: KiraDb,
  id: string,
  fields: ConnectionFields,
  updatedAt: string,
): Promise<ConnectionSummary> {
  await db
    .update(connections)
    .set({
      name: fields.name,
      kind: fields.kind,
      color: fields.color,
      mode: fields.mode,
      readOnly: fields.readOnly,
      host: fields.host,
      port: fields.port,
      database: fields.database,
      username: fields.username,
      uri: fields.uri,
      optionsJson: JSON.stringify(fields.options),
      preconnect: fields.preconnect,
      preconnectSidecar: fields.preconnectSidecar,
      updatedAt,
    })
    .where(eq(connections.id, id));
  const updated = await getConnection(db, id);
  if (!updated) throw new Error(`updateConnection: row ${id} not found`);
  return updated;
}

export async function deleteConnection(db: KiraDb, id: string): Promise<void> {
  await db.delete(connections).where(eq(connections.id, id));
}

export async function reorderConnections(db: KiraDb, ids: string[]): Promise<ConnectionSummary[]> {
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(connections).set({ sortOrder: index }).where(eq(connections.id, id));
    }
  });
  return listConnections(db);
}
