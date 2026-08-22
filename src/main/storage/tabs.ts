import { eq } from 'drizzle-orm';
import { type TabRecord, tabRecordSchema } from '../../shared/tabs';
import { log } from '../log';
import type { Db } from './db';
import { tabs } from './schema';

// `tabs` — session restore (§8.4 / D15). Persisted on a 250 ms debounce as a single replace
// transaction (the set is ≤ a few dozen rows; a diff would be more code and more bugs). Rows whose
// `state_json` fails Zod parsing are DROPPED (and logged) rather than throwing — a corrupt tab must
// not brick startup (R12).

export async function getAllTabs(db: Db): Promise<TabRecord[]> {
  const rows = await db.select().from(tabs).orderBy(tabs.order);
  const out: TabRecord[] = [];
  for (const row of rows) {
    const candidate: unknown = {
      id: row.id,
      connectionId: row.connectionId ?? '',
      path: row.path,
      kind: row.kind,
      state: JSON.parse(row.stateJson) as unknown,
      order: row.order,
      active: row.active,
    };
    const parsed = tabRecordSchema.safeParse(candidate);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      log(
        'warn',
        'tabs',
        `dropping unparseable tab row ${row.id}: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      );
    }
  }
  return out;
}

export async function replaceTabs(db: Db, records: TabRecord[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(tabs);
    for (const r of records) {
      await tx.insert(tabs).values({
        id: r.id,
        connectionId: r.connectionId,
        path: r.path,
        kind: r.kind,
        stateJson: JSON.stringify(r.state),
        order: r.order,
        active: r.active,
      });
    }
  });
}

export async function clearTabs(db: Db): Promise<void> {
  await db.delete(tabs);
}

export async function removeConnectionTabs(db: Db, connectionId: string): Promise<void> {
  await db.delete(tabs).where(eq(tabs.connectionId, connectionId));
}
