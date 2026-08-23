import type { Db, MongoClient } from 'mongodb';
import { encodePath, type TreeNode } from '../../../shared/domain/tree';
import { mapMongoError } from './errors';

// Databases mongod itself owns and that no user connection meaningfully browses — the same
// system-schema exclusion mariadb/catalog.ts applies for information_schema et al.
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
    throw mapMongoError(err);
  }
}

// §5.1: database -> collections (+ indexes). No routine/sequence-equivalent kind for Mongo.
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
        hasChildren: true, // + indexes (§5.1)
        detail: c.type === 'view' ? 'view' : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    throw mapMongoError(err);
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
    throw mapMongoError(err);
  }
}

// §8.10's dedicated index row — each index is its own addressable tree leaf, not folded into
// the collection node (D10).
export async function listIndexNodes(db: Db, collection: string): Promise<TreeNode[]> {
  const indexes = await describeIndexes(db, collection);
  return indexes.map((idx) => ({
    kind: 'index' as const,
    name: idx.name,
    path: encodePath([
      { kind: 'database', name: db.databaseName },
      { kind: 'collection', name: collection },
      { kind: 'index', name: idx.name },
    ]),
    hasChildren: false,
    detail: idx.unique ? 'unique' : undefined,
    badges: idx.name === '_id_' ? ['PK'] : undefined,
  }));
}
