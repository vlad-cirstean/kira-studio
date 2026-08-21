import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ConnectionColor,
  type ConnectionKind,
  type ConnectionMode,
  type ConnectionSummary,
  connectionColorSchema,
  connectionKindSchema,
  connectionModeSchema,
} from '../../shared/connection';
import { log } from '../log';
import type { Db } from './db';
import { connections } from './schema';

// Storage accessors for `connections`. Two deliberate choices:
//   - Never selects `password` — the SecretStore owns that column (§0/D8).
//   - A row that fails read-back validation is logged and skipped, not thrown: one hand-mangled
//     row must not make the app unlaunchable (unlike settings/layout, where a bad row means the
//     whole app has no settings — here it means one connection is broken).

const connectionRowSchema = z.object({
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
  createdAt: z.string(),
  updatedAt: z.string(),
  sortOrder: z.number(),
});

// The columns main writes, excluding id/timestamps/sort_order (assigned here) and password (owned
// by the SecretStore).
export interface ConnectionColumns {
  name: string;
  kind: ConnectionKind;
  color: ConnectionColor;
  mode: ConnectionMode;
  readOnly: boolean;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  uri: string | null;
  options: Record<string, unknown>;
}

function parseOptions(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function rowToSummary(row: unknown): ConnectionSummary | null {
  const parsed = connectionRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    color: r.color,
    mode: r.mode,
    readOnly: r.readOnly,
    host: r.host,
    port: r.port,
    database: r.database,
    username: r.username,
    uri: r.uri,
    options: parseOptions(r.optionsJson),
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function listConnections(db: Db): Promise<ConnectionSummary[]> {
  const rows = await db
    .select()
    .from(connections)
    .orderBy(asc(connections.sortOrder), asc(connections.name));
  const out: ConnectionSummary[] = [];
  for (const row of rows) {
    const summary = rowToSummary(row);
    if (summary) out.push(summary);
    else log('warn', 'connections', `skipping unparseable connection row: ${JSON.stringify(row)}`);
  }
  return out;
}

export async function getConnection(db: Db, id: string): Promise<ConnectionSummary | null> {
  const row = await db.select().from(connections).where(eq(connections.id, id)).get();
  return row ? rowToSummary(row) : null;
}

async function nextSortOrder(db: Db): Promise<number> {
  const rows = await db
    .select({ m: sql<number>`COALESCE(MAX(${connections.sortOrder}), -1)` })
    .from(connections);
  return Number(rows[0]?.m ?? -1) + 1;
}

export async function insertConnection(
  db: Db,
  id: string,
  cols: ConnectionColumns,
): Promise<ConnectionSummary> {
  const now = new Date().toISOString();
  const sortOrder = await nextSortOrder(db);
  const [row] = await db
    .insert(connections)
    .values({
      id,
      name: cols.name,
      kind: cols.kind,
      color: cols.color,
      mode: cols.mode,
      readOnly: cols.readOnly,
      host: cols.host,
      port: cols.port,
      database: cols.database,
      username: cols.username,
      uri: cols.uri,
      optionsJson: JSON.stringify(cols.options ?? {}),
      createdAt: now,
      updatedAt: now,
      sortOrder,
    })
    .returning();
  const summary = rowToSummary(row);
  if (!summary) throw new Error('inserted connection row failed read-back validation');
  return summary;
}

export async function updateConnection(
  db: Db,
  id: string,
  cols: ConnectionColumns,
): Promise<ConnectionSummary | null> {
  const now = new Date().toISOString();
  const [row] = await db
    .update(connections)
    .set({
      name: cols.name,
      kind: cols.kind,
      color: cols.color,
      mode: cols.mode,
      readOnly: cols.readOnly,
      host: cols.host,
      port: cols.port,
      database: cols.database,
      username: cols.username,
      uri: cols.uri,
      optionsJson: JSON.stringify(cols.options ?? {}),
      updatedAt: now,
    })
    .where(eq(connections.id, id))
    .returning();
  return row ? rowToSummary(row) : null;
}

export async function deleteConnection(db: Db, id: string): Promise<void> {
  await db.delete(connections).where(eq(connections.id, id));
}

export async function reorderConnections(db: Db, ids: string[]): Promise<ConnectionSummary[]> {
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(connections).set({ sortOrder: index }).where(eq(connections.id, id));
    }
  });
  return listConnections(db);
}
