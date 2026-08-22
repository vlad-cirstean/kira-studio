import { and, count, eq } from 'drizzle-orm';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { metadataCache } from '../schema/metadata-cache';

export type MetaKind = 'children' | 'describe' | 'ddl';

// The unique index is (connection_id, path) — `kind` is not part of the key, so a `children`
// payload and a `describe` payload for the same path share one row. Both live under this shape
// in `payload_json`; `kind` on the row is informational (whichever was written last).
interface CachedPayload {
  children?: unknown;
  describe?: unknown;
  ddl?: unknown;
}

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

async function readPayload(
  db: KiraDb,
  connectionId: string,
  path: string,
): Promise<CachedPayload | null> {
  const rows = await db
    .select({ payloadJson: metadataCache.payloadJson })
    .from(metadataCache)
    .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)));
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.payloadJson) as CachedPayload;
  } catch {
    return null;
  }
}

// JSON.parse'd, NOT validated here — callers parse through the domain Zod schema and drop the
// row (dropCached) on a shape mismatch, treating it as a miss rather than surfacing an error.
export async function getCached(
  db: KiraDb,
  connectionId: string,
  path: string,
  kind: MetaKind,
): Promise<unknown | null> {
  const payload = await readPayload(db, connectionId, path);
  return payload?.[kind] ?? null;
}

export async function putCached(
  db: KiraDb,
  connectionId: string,
  path: string,
  kind: MetaKind,
  payload: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ payloadJson: metadataCache.payloadJson })
      .from(metadataCache)
      .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)));
    let existing: CachedPayload = {};
    if (rows[0]) {
      try {
        existing = JSON.parse(rows[0].payloadJson) as CachedPayload;
      } catch {
        existing = {};
      }
    }
    const merged: CachedPayload = { ...existing, [kind]: payload };
    const json = JSON.stringify(merged);
    if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
      log(
        'warn',
        'storage/metadata-cache',
        `payload for ${connectionId}:${path} exceeds 4 MB, not cached`,
      );
      return;
    }
    const fetchedAt = new Date().toISOString();
    await tx
      .insert(metadataCache)
      .values({ connectionId, path, kind, payloadJson: json, fetchedAt, etag: null })
      .onConflictDoUpdate({
        target: [metadataCache.connectionId, metadataCache.path],
        set: { kind, payloadJson: json, fetchedAt },
      });
  });
}

// `path` omitted = drop every cached row for the whole connection.
export async function dropCached(db: KiraDb, connectionId: string, path?: string): Promise<void> {
  if (path === undefined) {
    await db.delete(metadataCache).where(eq(metadataCache.connectionId, connectionId));
  } else {
    await db
      .delete(metadataCache)
      .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)));
  }
}

export async function countCached(db: KiraDb, connectionId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(metadataCache)
    .where(eq(metadataCache.connectionId, connectionId));
  return rows[0]?.n ?? 0;
}
