import { and, desc, eq } from 'drizzle-orm';
import {
  type ConsoleBody,
  consoleBodySchema,
  type FilterBody,
  filterBodySchema,
  type SavedConsoleQuery,
  type SavedFilterQuery,
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

async function listByKind<K extends SavedQuery['kind']>(
  db: KiraDb,
  connectionId: string,
  path: string,
  kind: K,
): Promise<Extract<SavedQuery, { kind: K }>[]> {
  const rows = await db
    .select()
    .from(savedQueries)
    .where(
      and(
        eq(savedQueries.connectionId, connectionId),
        eq(savedQueries.path, path),
        eq(savedQueries.kind, kind),
      ),
    )
    .orderBy(desc(savedQueries.pinned), desc(savedQueries.usedAt), savedQueries.name);
  const out: Extract<SavedQuery, { kind: K }>[] = [];
  for (const row of rows) {
    const parsed = parseSavedQueryRow(row);
    if (parsed && parsed.kind === kind) out.push(parsed as Extract<SavedQuery, { kind: K }>);
  }
  return out;
}

export async function listSavedFilters(
  db: KiraDb,
  connectionId: string,
  path: string,
): Promise<SavedFilterQuery[]> {
  return listByKind(db, connectionId, path, 'filter');
}

export async function listSavedConsoleQueries(
  db: KiraDb,
  connectionId: string,
  path: string,
): Promise<SavedConsoleQuery[]> {
  return listByKind(db, connectionId, path, 'console');
}

async function insertSavedQuery(
  db: KiraDb,
  input: {
    connectionId: string;
    path: string;
    name: string;
    kind: SavedQuery['kind'];
    body: string;
    pinned: boolean;
  },
): Promise<SavedQuery> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(savedQueries).values({
    id,
    connectionId: input.connectionId,
    path: input.path,
    name: input.name,
    kind: input.kind,
    body: input.body,
    pinned: input.pinned,
    createdAt: now,
    usedAt: now,
  });
  const row = (await db.select().from(savedQueries).where(eq(savedQueries.id, id)))[0];
  const parsed = row ? parseSavedQueryRow(row) : null;
  if (!parsed) throw new Error('insertSavedQuery: freshly inserted row failed to parse');
  return parsed;
}

export async function saveFilter(
  db: KiraDb,
  input: { connectionId: string; path: string; name: string; body: FilterBody; pinned: boolean },
): Promise<SavedFilterQuery> {
  const saved = await insertSavedQuery(db, {
    ...input,
    kind: 'filter',
    body: JSON.stringify(filterBodySchema.parse(input.body)),
  });
  if (saved.kind !== 'filter') throw new Error('saveFilter: inserted row is not kind filter');
  return saved;
}

export async function saveConsoleQuery(
  db: KiraDb,
  input: { connectionId: string; path: string; name: string; body: ConsoleBody; pinned: boolean },
): Promise<SavedConsoleQuery> {
  const saved = await insertSavedQuery(db, {
    ...input,
    kind: 'console',
    body: JSON.stringify(consoleBodySchema.parse(input.body)),
  });
  if (saved.kind !== 'console') {
    throw new Error('saveConsoleQuery: inserted row is not kind console');
  }
  return saved;
}

// Kind-agnostic: `id` alone identifies the row, and neither op touches `body`/`kind` — one
// implementation serves both saved filters (§8.5) and saved console queries (§8.14).
export async function updateSavedQuery(
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
  if (!parsed) throw new Error(`updateSavedQuery: row ${id} not found after update`);
  return parsed;
}

export async function deleteSavedQuery(db: KiraDb, id: string): Promise<void> {
  await db.delete(savedQueries).where(eq(savedQueries.id, id));
}

export async function touchSavedQuery(db: KiraDb, id: string): Promise<void> {
  await db
    .update(savedQueries)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(savedQueries.id, id));
}
