import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ConnectionFilter,
  type ConnectionFilterInput,
  connectionFilterSchema,
} from '../../shared/connection';
import { log } from '../log';
import type { Db } from './db';
import { connectionFilters } from './schema';

// `connection_filters` — persistent hide/show rules per connection (SPEC §8.3). Replace-whole-set
// rather than per-row CRUD: the dialog edits a list and saves it, and the set is tiny.

const filterRowSchema = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    nodeKind: connectionFilterSchema.shape.nodeKind,
    pattern: z.string(),
    isRegex: z.boolean(),
    action: connectionFilterSchema.shape.action,
  })
  .transform((r) => ({
    id: r.id,
    connectionId: r.connectionId,
    nodeKind: r.nodeKind,
    pattern: r.pattern,
    isRegex: r.isRegex,
    action: r.action,
  }));

export async function listFilters(db: Db, connectionId: string): Promise<ConnectionFilter[]> {
  const rows = await db
    .select()
    .from(connectionFilters)
    .where(eq(connectionFilters.connectionId, connectionId));
  const out: ConnectionFilter[] = [];
  for (const row of rows) {
    const parsed = filterRowSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else log('warn', 'filters', `skipping unparseable filter row: ${JSON.stringify(row)}`);
  }
  return out;
}

export async function replaceFilters(
  db: Db,
  connectionId: string,
  inputs: ConnectionFilterInput[],
): Promise<ConnectionFilter[]> {
  await db.transaction(async (tx) => {
    await tx.delete(connectionFilters).where(eq(connectionFilters.connectionId, connectionId));
    for (const input of inputs) {
      await tx.insert(connectionFilters).values({
        id: randomUUID(),
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
