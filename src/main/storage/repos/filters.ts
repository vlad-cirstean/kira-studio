import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ConnectionFilter,
  type ConnectionFilterInput,
  filterActionSchema,
  filterNodeKindSchema,
} from '../../../shared/domain/connection-filter';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { connectionFilters } from '../schema/connection-filters';

const filterRowSchema = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    nodeKind: filterNodeKindSchema,
    pattern: z.string(),
    isRegex: z.boolean(),
    action: filterActionSchema,
  })
  .transform(
    (row): ConnectionFilter => ({
      id: row.id,
      connectionId: row.connectionId,
      nodeKind: row.nodeKind,
      pattern: row.pattern,
      isRegex: row.isRegex,
      action: row.action,
    }),
  );

export async function listFilters(db: KiraDb, connectionId: string): Promise<ConnectionFilter[]> {
  const rows = await db
    .select()
    .from(connectionFilters)
    .where(eq(connectionFilters.connectionId, connectionId))
    // Matches the pre-Drizzle `ORDER BY rowid`: insertion order, since replaceFilters() always
    // does a full delete-then-insert of the whole set in `inputs` order.
    .orderBy(sql`rowid`);
  const out: ConnectionFilter[] = [];
  for (const row of rows) {
    const parsed = filterRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      log('warn', 'storage/filters', `dropping unparseable filter row: ${parsed.error.message}`);
    }
  }
  return out;
}

// Delete-all + insert, one transaction: the dialog edits a whole list and saves it, and the
// set is small enough that a per-row diff would add complexity for no benefit.
export async function replaceFilters(
  db: KiraDb,
  connectionId: string,
  inputs: ConnectionFilterInput[],
): Promise<ConnectionFilter[]> {
  await db.transaction(async (tx) => {
    await tx.delete(connectionFilters).where(eq(connectionFilters.connectionId, connectionId));
    for (const input of inputs) {
      await tx.insert(connectionFilters).values({
        id: crypto.randomUUID(),
        connectionId,
        nodeKind: input.nodeKind,
        pattern: input.pattern,
        isRegex: input.isRegex,
        action: input.action,
      });
    }
  });
  return listFilters(db, connectionId);
}
