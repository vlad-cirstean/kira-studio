import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  HISTORY_LIMIT,
  type SavedQuery,
  savedQuerySchema,
} from '../../shared/saved-query';
import { log } from '../log';
import type { Db } from './db';
import { savedQueries } from './schema';

// `saved_queries` — history and saved entries are the SAME rows, distinguished by `name` (D14).
// Unnamed rows are history, pruned to the newest HISTORY_LIMIT per (connection, path); named rows
// are pinned, never pruned, and sort first in the history dropdown. `kind` stays free for P5.5's
// console entries in the same store.

export async function listSavedQueries(
  db: Db,
  payload: { connectionId: string; path: string; kind: string },
): Promise<SavedQuery[]> {
  const rows = await db
    .select()
    .from(savedQueries)
    .where(
      and(
        eq(savedQueries.connectionId, payload.connectionId),
        eq(savedQueries.path, payload.path),
        eq(savedQueries.kind, payload.kind),
      ),
    )
    .orderBy(desc(savedQueries.name), desc(savedQueries.usedAt));
  const out: SavedQuery[] = [];
  for (const row of rows) {
    const candidate: unknown = {
      id: row.id,
      connectionId: row.connectionId,
      path: row.path,
      name: row.name,
      kind: row.kind,
      body: JSON.parse(row.body) as unknown,
      createdAt: row.createdAt,
      usedAt: row.usedAt,
    };
    const parsed = savedQuerySchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
    else log('warn', 'saved-queries', `skipping unparseable saved query row: ${JSON.stringify(row)}`);
  }
  // named first (by name), then unnamed by usedAt desc — desc(name) already puts '' last.
  return out;
}

export async function upsertSavedQuery(
  db: Db,
  payload: {
    connectionId: string;
    path: string;
    name: string;
    kind: string;
    body: { where: string; orderBy: string };
  },
): Promise<SavedQuery> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(savedQueries).values({
    id,
    connectionId: payload.connectionId,
    path: payload.path,
    name: payload.name,
    kind: payload.kind,
    body: JSON.stringify(payload.body),
    createdAt: now,
    usedAt: now,
  });
  const saved = await getSavedQuery(db, id);
  if (!saved) throw new Error('saved query insert failed');
  return saved;
}

export async function touchSavedQuery(db: Db, id: string): Promise<void> {
  await db
    .update(savedQueries)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(savedQueries.id, id));
}

export async function deleteSavedQuery(db: Db, id: string): Promise<void> {
  await db.delete(savedQueries).where(eq(savedQueries.id, id));
}

async function getSavedQuery(db: Db, id: string): Promise<SavedQuery | null> {
  const row = await db.select().from(savedQueries).where(eq(savedQueries.id, id)).get();
  if (!row) return null;
  const candidate: unknown = {
    id: row.id,
    connectionId: row.connectionId,
    path: row.path,
    name: row.name,
    kind: row.kind,
    body: JSON.parse(row.body) as unknown,
    createdAt: row.createdAt,
    usedAt: row.usedAt,
  };
  const parsed = savedQuerySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// D14: after every successful apply, prune unnamed rows beyond the newest HISTORY_LIMIT for this
// table. Named rows survive.
export async function pruneHistory(
  db: Db,
  connectionId: string,
  path: string,
): Promise<void> {
  const rows = await db
    .select({ id: savedQueries.id })
    .from(savedQueries)
    .where(
      and(
        eq(savedQueries.connectionId, connectionId),
        eq(savedQueries.path, path),
        eq(savedQueries.name, ''),
      ),
    )
    .orderBy(desc(savedQueries.usedAt));
  const keep = new Set(rows.slice(0, HISTORY_LIMIT).map((r) => r.id));
  for (const row of rows) {
    if (!keep.has(row.id)) await db.delete(savedQueries).where(eq(savedQueries.id, row.id));
  }
}
