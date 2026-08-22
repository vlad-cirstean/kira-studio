import { log } from '../../log';
import type { Db } from '../db';

export type MetaKind = 'children' | 'describe';

// The unique index is (connection_id, path) — `kind` is not part of the key, so a `children`
// payload and a `describe` payload for the same path share one row. Both live under this shape
// in `payload_json`; `kind` on the row is informational (whichever was written last).
interface CachedPayload {
  children?: unknown;
  describe?: unknown;
}

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

interface CacheRow {
  payload_json: string;
}

function readPayload(db: Db, connectionId: string, path: string): CachedPayload | null {
  const row = db.get(
    'SELECT payload_json FROM metadata_cache WHERE connection_id = ? AND path = ?',
    [connectionId, path],
  ) as CacheRow | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as CachedPayload;
  } catch {
    return null;
  }
}

// JSON.parse'd, NOT validated here — callers parse through the domain Zod schema and drop the
// row (dropCached) on a shape mismatch, treating it as a miss rather than surfacing an error.
export function getCached(
  db: Db,
  connectionId: string,
  path: string,
  kind: MetaKind,
): unknown | null {
  const payload = readPayload(db, connectionId, path);
  return payload?.[kind] ?? null;
}

export function putCached(
  db: Db,
  connectionId: string,
  path: string,
  kind: MetaKind,
  payload: unknown,
): void {
  db.transaction(() => {
    const existing = readPayload(db, connectionId, path) ?? {};
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
    db.run(
      `INSERT INTO metadata_cache (connection_id, path, kind, payload_json, fetched_at, etag)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(connection_id, path) DO UPDATE SET
         kind = excluded.kind, payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
      [connectionId, path, kind, json, fetchedAt],
    );
  });
}

// `path` omitted = drop every cached row for the whole connection.
export function dropCached(db: Db, connectionId: string, path?: string): void {
  if (path === undefined) {
    db.run('DELETE FROM metadata_cache WHERE connection_id = ?', [connectionId]);
  } else {
    db.run('DELETE FROM metadata_cache WHERE connection_id = ? AND path = ?', [connectionId, path]);
  }
}

export function countCached(db: Db, connectionId: string): number {
  const row = db.get('SELECT COUNT(*) AS n FROM metadata_cache WHERE connection_id = ?', [
    connectionId,
  ]) as { n: number } | undefined;
  return row?.n ?? 0;
}
