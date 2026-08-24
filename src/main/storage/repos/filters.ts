import { eq } from 'drizzle-orm';
import type { TreeVisibility } from '../../../shared/domain/tree-filter';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { connectionTreeFilters } from '../schema/connection-tree-filters';

export async function listVisibility(db: KiraDb, connectionId: string): Promise<TreeVisibility> {
  const rows = await db
    .select()
    .from(connectionTreeFilters)
    .where(eq(connectionTreeFilters.connectionId, connectionId));
  const hiddenKinds: TreeVisibility['hiddenKinds'] = [];
  const hiddenPaths: string[] = [];
  for (const row of rows) {
    if (row.scope === 'kind') {
      hiddenKinds.push(row.value as TreeVisibility['hiddenKinds'][number]);
    } else if (row.scope === 'path') {
      hiddenPaths.push(row.value);
    } else {
      log('warn', 'storage/filters', `dropping unrecognised filter scope: ${row.scope}`);
    }
  }
  return { hiddenKinds, hiddenPaths };
}

// Delete-all + insert, one transaction: the dialog edits a whole set and saves it, and the set is
// small enough that a per-row diff would add complexity for no benefit (matches the old rule
// table's own replaceFilters()).
export async function replaceVisibility(
  db: KiraDb,
  connectionId: string,
  visibility: TreeVisibility,
): Promise<TreeVisibility> {
  await db.transaction(async (tx) => {
    await tx
      .delete(connectionTreeFilters)
      .where(eq(connectionTreeFilters.connectionId, connectionId));
    for (const kind of visibility.hiddenKinds) {
      await tx.insert(connectionTreeFilters).values({ connectionId, scope: 'kind', value: kind });
    }
    for (const path of visibility.hiddenPaths) {
      await tx.insert(connectionTreeFilters).values({ connectionId, scope: 'path', value: path });
    }
  });
  return listVisibility(db, connectionId);
}
