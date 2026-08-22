import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  type FilterHistoryEntry,
  filterHistoryEntrySchema,
  type SortSpec,
} from '../../../shared/domain/queries';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { filterHistory } from '../schema/filter-history';

const HISTORY_LIMIT = 20;

export async function recordFilterUse(
  db: KiraDb,
  input: { connectionId: string; path: string; where: string | null; orderBy: SortSpec | null },
): Promise<void> {
  // "I cleared the filter" is not history.
  if (input.where === null && input.orderBy === null) return;

  const whereText = input.where;
  const orderByJson = input.orderBy ? JSON.stringify(input.orderBy) : null;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    // Re-applying the same filter moves it to the top rather than duplicating it.
    await tx
      .delete(filterHistory)
      .where(
        and(
          eq(filterHistory.connectionId, input.connectionId),
          eq(filterHistory.path, input.path),
          whereText === null
            ? isNull(filterHistory.whereText)
            : eq(filterHistory.whereText, whereText),
          orderByJson === null
            ? isNull(filterHistory.orderByJson)
            : eq(filterHistory.orderByJson, orderByJson),
        ),
      );

    await tx.insert(filterHistory).values({
      id: crypto.randomUUID(),
      connectionId: input.connectionId,
      path: input.path,
      whereText,
      orderByJson,
      usedAt: now,
    });

    const rows = await tx
      .select({ id: filterHistory.id })
      .from(filterHistory)
      .where(
        and(eq(filterHistory.connectionId, input.connectionId), eq(filterHistory.path, input.path)),
      )
      .orderBy(desc(filterHistory.usedAt));
    for (const stale of rows.slice(HISTORY_LIMIT)) {
      await tx.delete(filterHistory).where(eq(filterHistory.id, stale.id));
    }
  });
}

export async function listFilterHistory(
  db: KiraDb,
  connectionId: string,
  path: string,
  limit: number,
): Promise<FilterHistoryEntry[]> {
  const rows = await db
    .select()
    .from(filterHistory)
    .where(and(eq(filterHistory.connectionId, connectionId), eq(filterHistory.path, path)))
    .orderBy(desc(filterHistory.usedAt))
    .limit(limit);

  const out: FilterHistoryEntry[] = [];
  for (const row of rows) {
    let orderBy: unknown = null;
    if (row.orderByJson !== null) {
      try {
        orderBy = JSON.parse(row.orderByJson);
      } catch {
        log(
          'warn',
          'storage/filter-history',
          `dropping history row ${row.id}: order_by_json is not valid JSON`,
        );
        continue;
      }
    }
    const parsed = filterHistoryEntrySchema.safeParse({
      id: row.id,
      connectionId: row.connectionId,
      path: row.path,
      where: row.whereText,
      orderBy,
      usedAt: row.usedAt,
    });
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      log(
        'warn',
        'storage/filter-history',
        `dropping unparseable history row ${row.id}: ${parsed.error.message}`,
      );
    }
  }
  return out;
}
