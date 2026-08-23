import { asc } from 'drizzle-orm';
import { RENDERABLE_TAB_KINDS, type TabRecord, tabRecordSchema } from '../../../shared/domain/tabs';
import { log } from '../../log';
import type { KiraDb } from '../db';
import { tabs } from '../schema/tabs';

export async function listTabs(db: KiraDb): Promise<TabRecord[]> {
  const rows = await db.select().from(tabs).orderBy(asc(tabs.order));
  const out: TabRecord[] = [];
  for (const row of rows) {
    let state: unknown;
    try {
      state = JSON.parse(row.stateJson);
    } catch {
      log('warn', 'storage/tabs', `dropping tab ${row.id}: state_json is not valid JSON`);
      continue;
    }
    // P19 legacy coercion: a tab persisted before the ddl->definition rename has kind: 'ddl' on
    // disk — map it forward rather than dropping every already-open DDL/definition tab on the
    // first launch after the upgrade. definitionTabStateSchema's `.default('structure')` handles
    // the old empty `{}` state shape already stored alongside it.
    const kind = row.kind === 'ddl' ? 'definition' : row.kind;
    const candidate = {
      id: row.id,
      connectionId: row.connectionId,
      path: row.path,
      kind,
      state,
      order: row.order,
      active: row.active,
    };
    const parsed = tabRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      log(
        'warn',
        'storage/tabs',
        `dropping unparseable tab row ${row.id}: ${parsed.error.message}`,
      );
      continue;
    }
    // Only RENDERABLE_TAB_KINDS is renderable (D18) — a row of any other kind is dropped, logged,
    // and not re-saved, the same "corrupt row is a miss" discipline as the metadata cache.
    if (!RENDERABLE_TAB_KINDS.includes(parsed.data.kind)) {
      log(
        'warn',
        'storage/tabs',
        `dropping non-renderable tab kind on restore: ${parsed.data.kind}`,
      );
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

// Delete-all + insert, one transaction, rewriting `order` as the array index so the stored
// order is always dense (D17, mirrors filters.ts's whole-set replace pattern).
export async function replaceTabs(db: KiraDb, records: TabRecord[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(tabs);
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      await tx.insert(tabs).values({
        id: r.id,
        connectionId: r.connectionId,
        path: r.path,
        kind: r.kind,
        stateJson: JSON.stringify(r.state),
        order: i,
        active: r.active,
      });
    }
  });
}
