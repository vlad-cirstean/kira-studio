import { encodePath, type TreeNode } from '@shared/domain/tree';
import type { CollectionInfo, Db, Document, MongoClient } from 'mongodb';
import { mapError } from './errors';

// Databases mongod itself owns and that no user connection meaningfully browses — the same
// system-schema exclusion mysql-family/catalog.ts applies for information_schema et al.
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

export async function listDatabases(client: MongoClient): Promise<TreeNode[]> {
  try {
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    return databases
      .filter((d) => !SYSTEM_DATABASES.has(d.name))
      .map((d) => ({
        kind: 'database' as const,
        name: d.name,
        path: encodePath([{ kind: 'database', name: d.name }]),
        hasChildren: true,
      }));
  } catch (err) {
    throw mapError(err);
  }
}

// §5.1: database -> collections. No routine/sequence-equivalent kind for Mongo.
export async function listCollections(db: Db): Promise<TreeNode[]> {
  try {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return collections
      .map((c) => ({
        kind: 'collection' as const,
        name: c.name,
        path: encodePath([
          { kind: 'database', name: db.databaseName },
          { kind: 'collection', name: c.name },
        ]),
        // P19 D5's own SQL-relation precedent: a collection's indexes moved into the definition
        // view, so a collection is a leaf like a table — no tree expand arrow.
        hasChildren: false,
        detail: c.type === 'view' ? 'view' : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    throw mapError(err);
  }
}

// The definition view's own lookup (P19 D12) — never called from the tree's listCollections,
// which keeps `nameOnly: true` so a database expand costs nothing extra per collection.
export async function collectionOptions(db: Db, collection: string): Promise<Document | undefined> {
  try {
    const [info] = await db.listCollections<CollectionInfo>({ name: collection }, {}).toArray();
    return info?.options;
  } catch (err) {
    throw mapError(err);
  }
}

export interface MongoIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export async function describeIndexes(db: Db, collection: string): Promise<MongoIndexInfo[]> {
  try {
    const indexes = await db.collection(collection).listIndexes().toArray();
    return indexes.map((idx) => ({
      name: idx.name ?? '',
      columns: Object.keys((idx.key ?? {}) as Record<string, unknown>),
      unique: idx.unique === true,
    }));
  } catch (err) {
    throw mapError(err);
  }
}
