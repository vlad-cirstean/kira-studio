import { and, desc, eq } from 'drizzle-orm';
import {
  type FilterBody,
  filterBodySchema,
  type SavedQuery,
  savedQuerySchema,
} from '../../../shared/domain/queries';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { savedQueries } from '../schema/saved-queries';

interface SavedQueryRow {
  id: string;
  connectionId: string;
  path: string;
  name: string;
  kind: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  usedAt: string | null;
}

function parseSavedQueryRow(row: SavedQueryRow): SavedQuery | null {
  let body: unknown;
  try {
    body = JSON.parse(row.body);
  } catch {
    log('warn', 'storage/saved-queries', `dropping saved query ${row.id}: body is not valid JSON`);
    return null;
  }
  const parsed = savedQuerySchema.safeParse({ ...row, body });
  if (!parsed.success) {
    log(
      'warn',
      'storage/saved-queries',
      `dropping unparseable saved query ${row.id}: ${parsed.error.message}`,
    );
    return null;
  }
  return parsed.data;
}

export async function listSavedFilters(
  db: KiraDb,
  connectionId: string,
  path: string,
): Promise<SavedQuery[]> {
  const rows = await db
    .select()
    .from(savedQueries)
    .where(
      and(
        eq(savedQueries.connectionId, connectionId),
        eq(savedQueries.path, path),
        eq(savedQueries.kind, 'filter'),
      ),
    )
    .orderBy(desc(savedQueries.pinned), desc(savedQueries.usedAt), savedQueries.name);
  const out: SavedQuery[] = [];
  for (const row of rows) {
    const parsed = parseSavedQueryRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function saveFilter(
  db: KiraDb,
  input: { connectionId: string; path: string; name: string; body: FilterBody; pinned: boolean },
): Promise<SavedQuery> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(savedQueries).values({
    id,
    connectionId: input.connectionId,
    path: input.path,
    name: input.name,
    kind: 'filter',
    body: JSON.stringify(filterBodySchema.parse(input.body)),
    pinned: input.pinned,
    createdAt: now,
    usedAt: now,
  });
  const row = (await db.select().from(savedQueries).where(eq(savedQueries.id, id)))[0];
  const parsed = row ? parseSavedQueryRow(row) : null;
  if (!parsed) throw new Error('saveFilter: freshly inserted row failed to parse');
  return parsed;
}

export async function updateSavedFilter(
  db: KiraDb,
  id: string,
  patch: { name?: string; pinned?: boolean },
): Promise<SavedQuery> {
  await db
    .update(savedQueries)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    })
    .where(eq(savedQueries.id, id));
  const row = (await db.select().from(savedQueries).where(eq(savedQueries.id, id)))[0];
  const parsed = row ? parseSavedQueryRow(row) : null;
  if (!parsed) throw new Error(`updateSavedFilter: row ${id} not found after update`);
  return parsed;
}

export async function deleteSavedFilter(db: KiraDb, id: string): Promise<void> {
  await db.delete(savedQueries).where(eq(savedQueries.id, id));
}

export async function touchSavedFilter(db: KiraDb, id: string): Promise<void> {
  await db
    .update(savedQueries)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(savedQueries.id, id));
}
