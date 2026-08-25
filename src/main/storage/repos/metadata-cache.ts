import { and, desc, eq, notInArray } from 'drizzle-orm';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { metadataCache } from '../schema/metadata-cache';

export type MetaKind = 'children' | 'describe' | 'definition';

// The unique index is (connection_id, path) — `kind` is not part of the key, so a `children`
// payload and a `describe` payload for the same path share one row. Both live under this shape
// in `payload_json`; `kind` on the row is informational (whichever was written last).
interface CachedPayload {
  children?: unknown;
  describe?: unknown;
  definition?: unknown;
}

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
// P43 iter2 F15/D20: a Browse session writes one row per level navigated, each up to
// MAX_PAYLOAD_BYTES, with no eviction until the connection's next successful connect
// (main/connections.ts's own dropCached) — a single session that browses deep leaves the on-disk
// cache unbounded until then. Per-connection (not global) so one heavily-browsed S3 connection
// cannot evict a small Postgres connection's whole tree. Same order as db.ts's own
// STMT_CACHE_MAX and repos/ops.ts's HARD_CAP_ROWS; an evicted level costs one round trip to
// re-fetch.
const MAX_ROWS_PER_CONNECTION = 200;

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

    // D20's eviction pass: keep this connection's MAX_ROWS_PER_CONNECTION newest-`fetched_at`
    // rows, drop the rest. An `onConflictDoUpdate` above never grows the connection's row count,
    // so this only ever has anything to do right after the insert branch actually added a row —
    // but running it unconditionally is one cheap indexed query against a table this small, not
    // a cost worth special-casing around.
    const keep = await tx
      .select({ path: metadataCache.path })
      .from(metadataCache)
      .where(eq(metadataCache.connectionId, connectionId))
      .orderBy(desc(metadataCache.fetchedAt))
      .limit(MAX_ROWS_PER_CONNECTION);
    const keepPaths = keep.map((r) => r.path);
    if (keepPaths.length > 0) {
      await tx
        .delete(metadataCache)
        .where(
          and(
            eq(metadataCache.connectionId, connectionId),
            notInArray(metadataCache.path, keepPaths),
          ),
        );
    }
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
