import { EJSON } from 'bson';
import type { Db, Document } from 'mongodb';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import { encodePath } from '../../../shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapMongoError } from './errors';

// D3: the reserved sentinel key for a whole-document replace, expressed through the existing
// relational-shaped MutationRowOp rather than widening the shared mutation schema — `$` can
// never start a real top-level Mongo field name, so it can never collide with genuine data.
const DOCUMENT_SENTINEL = '$document';

function resolveCollectionPath(path: MutationPlan['path']): {
  database: string;
  collection: string;
} {
  const [databaseSegment, objectSegment] = path.segments;
  if (
    path.segments.length !== 2 ||
    databaseSegment?.kind !== 'database' ||
    !objectSegment ||
    objectSegment.kind !== 'collection'
  ) {
    throw new AdapterError(
      'E_NOT_FOUND',
      `mutate requires a database/collection path, got: ${encodePath(path.segments)}`,
    );
  }
  return { database: databaseSegment.name, collection: objectSegment.name };
}

function parseIdKey(key: Record<string, string | null>): unknown {
  const names = Object.keys(key);
  if (names.length !== 1 || names[0] !== '_id') {
    throw new AdapterError('E_QUERY', 'a document mutation key must be exactly { _id }');
  }
  const raw = key._id;
  if (raw === null) return null;
  try {
    return EJSON.parse(raw);
  } catch {
    throw new AdapterError('E_QUERY', 'malformed _id in mutation key');
  }
}

function renderOpText(op: MutationRowOp, collectionName: string): string {
  if (op.kind === 'update') {
    const doc = op.changes[DOCUMENT_SENTINEL];
    if (typeof doc !== 'string') {
      throw new AdapterError('E_UNSUPPORTED', 'document mutation requires a $document replacement');
    }
    return `db.${collectionName}.replaceOne({_id: ...}, ${doc})`;
  }
  if (op.kind === 'delete') {
    return `db.${collectionName}.deleteOne({_id: ...})`;
  }
  throw new AdapterError('E_UNSUPPORTED', 'insert is not supported for documents in P8');
}

// Synchronous (Adapter rule 3's discipline): no network, no catalog lookup.
export function preview(plan: MutationPlan): string[] {
  const { collection } = resolveCollectionPath(plan.path);
  return plan.ops.map((op) => renderOpText(op, collection));
}

export async function mutate(
  db: Db,
  ctx: OpCtx,
  readOnly: boolean,
  plan: MutationPlan,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (mirrors mariadb/mutate.ts).
  if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');

  const { collection: collectionName } = resolveCollectionPath(plan.path);
  const collection = db.collection(collectionName);
  ctx.setCommand(preview(plan).join(';\n'));

  let affectedRows = 0;
  try {
    for (const op of plan.ops) {
      if (op.kind === 'update') {
        const id = parseIdKey(op.key);
        const bodyText = op.changes[DOCUMENT_SENTINEL];
        if (typeof bodyText !== 'string') {
          throw new AdapterError(
            'E_UNSUPPORTED',
            'document mutation requires a $document replacement',
          );
        }
        let parsed: unknown;
        try {
          parsed = EJSON.parse(bodyText);
        } catch {
          throw new AdapterError('E_QUERY', 'malformed document JSON');
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new AdapterError('E_QUERY', 'document must be a JSON object');
        }
        const replacement = { ...(parsed as Document), _id: id };
        // replaceOne() has no AbortSignal support in the driver (unlike find/findOne/
        // countDocuments/aggregate) — `comment` still tags it for D7's killOp fallback.
        const result = await collection.replaceOne({ _id: id } as Document, replacement, {
          comment: ctx.opId,
        });
        if (result.matchedCount !== 1) {
          throw new AdapterError(
            'E_QUERY',
            `expected update to affect exactly one document, matched ${result.matchedCount}`,
          );
        }
        affectedRows += result.matchedCount;
      } else if (op.kind === 'delete') {
        const id = parseIdKey(op.key);
        const result = await collection.deleteOne({ _id: id } as Document, {
          comment: ctx.opId,
        });
        if (result.deletedCount !== 1) {
          throw new AdapterError(
            'E_QUERY',
            `expected delete to affect exactly one document, deleted ${result.deletedCount}`,
          );
        }
        affectedRows += result.deletedCount;
      } else {
        throw new AdapterError('E_UNSUPPORTED', 'insert is not supported for documents in P8');
      }
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw mapMongoError(err);
  }

  return { affectedRows };
}
