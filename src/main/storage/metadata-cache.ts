import { and, eq, sql } from 'drizzle-orm';
import { log } from '../log';
import type { Db } from './db';
import { metadataCache } from './schema';

// L1 metadata cache (D10 / SPEC §7): persisted in `metadata_cache`, survives restart, no TTL.
// The unique index is (connection_id, path) — `kind` is NOT part of the key — so a `children`
// payload and a `describe` payload for the same path live in one row as
// `{ children?: TreeNode[]; describe?: ObjectMeta }`, with the `kind` column set to whichever was
// written last (informational). P4 adds `ddl?: SourceText` as a third slot in the same row. See
// Step 2d of the P1 plan.

export type MetaKind = 'children' | 'describe' | 'ddl';

// L1's only size story: a payload whose JSON exceeds 4 MB is not cached. A schema with 200 000
// relations should degrade to "slow expand", not a bloated SQLite file.
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

export async function getCached(
  db: Db,
  connectionId: string,
  path: string,
  kind: MetaKind,
): Promise<unknown | null> {
  const row = await db
    .select({ payloadJson: metadataCache.payloadJson })
    .from(metadataCache)
    .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)))
    .get();
  if (!row) return null;
  try {
    const merged = JSON.parse(row.payloadJson) as Record<string, unknown>;
    return merged[kind] ?? null;
  } catch {
    return null;
  }
}

// Reads-modifies-writes the existing row so both payload kinds share one row. Not re-entrant — call
// it only outside a transaction (its only P1 caller, tree-service, does).
export async function putCached(
  db: Db,
  connectionId: string,
  path: string,
  kind: MetaKind,
  payload: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ payloadJson: metadataCache.payloadJson })
      .from(metadataCache)
      .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)))
      .get();

    let merged: Record<string, unknown> = {};
    if (existing) {
      try {
        const parsed = JSON.parse(existing.payloadJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          merged = parsed as Record<string, unknown>;
        }
      } catch {
        merged = {};
      }
    }
    merged[kind] = payload;
    const json = JSON.stringify(merged);
    if (json.length > MAX_PAYLOAD_BYTES) {
      log('warn', 'metadata-cache', `payload for ${connectionId}/${path} exceeds 4 MB, not cached`);
      return;
    }
    const now = new Date().toISOString();
    if (existing) {
      await tx
        .update(metadataCache)
        .set({ payloadJson: json, kind, fetchedAt: now })
        .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)));
    } else {
      await tx.insert(metadataCache).values({
        connectionId,
        path,
        kind,
        payloadJson: json,
        fetchedAt: now,
      });
    }
  });
}

export async function dropCached(db: Db, connectionId: string, path?: string): Promise<void> {
  if (path === undefined) {
    await db.delete(metadataCache).where(eq(metadataCache.connectionId, connectionId));
  } else {
    await db
      .delete(metadataCache)
      .where(and(eq(metadataCache.connectionId, connectionId), eq(metadataCache.path, path)));
  }
}

export async function countCached(db: Db, connectionId: string): Promise<number> {
  const row = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(metadataCache)
    .where(eq(metadataCache.connectionId, connectionId))
    .get();
  return Number(row?.n ?? 0);
}
