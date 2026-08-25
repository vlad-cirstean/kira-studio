import type { Db, Document } from 'mongodb';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import { encodePath } from '../../../shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable } from '../errors';
import { mapError } from './errors';
import { parseDocumentLiteral, parseJson5Literal, resolveEjsonWrappers } from './literal';

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
    // P27 D16: an `_id` is a value, not a document — this composes the same two primitives
    // parseDocumentLiteral does (JSON5-lite parse + wrapper resolution) rather than routing
    // through parseDocumentLiteral's own object-only shape, since `_id` need not be an object.
    return resolveEjsonWrappers(parseJson5Literal(raw));
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
  const doc = op.values[DOCUMENT_SENTINEL];
  if (typeof doc !== 'string') {
    throw new AdapterError('E_UNSUPPORTED', 'document mutation requires a $document body');
  }
  return `db.${collectionName}.insertOne(${doc})`;
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
  // §8.12's standard: enforced here, not only greyed out in the UI (mirrors mysql-family/mutate.ts).
  assertWritable(readOnly);

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
        const parsed = parseDocumentLiteral(bodyText);
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
        // op.kind === 'insert': the same '$document' sentinel the update branch uses, holding
        // the new document's full EJSON body rather than a replacement for an existing one — no
        // `key` to parse, since insertOne() assigns a fresh ObjectId when the body omits `_id`.
        const bodyText = op.values[DOCUMENT_SENTINEL];
        if (typeof bodyText !== 'string') {
          throw new AdapterError('E_UNSUPPORTED', 'document mutation requires a $document body');
        }
        const parsed = parseDocumentLiteral(bodyText);
        // insertOne() has no AbortSignal support in the driver (same gap replaceOne/deleteOne
        // have above) — `comment` still tags it for D7's killOp fallback.
        const result = await collection.insertOne(parsed as Document, { comment: ctx.opId });
        if (!result.acknowledged) {
          throw new AdapterError('E_QUERY', 'insert was not acknowledged by the server');
        }
        affectedRows += 1;
      }
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw mapError(err);
  }

  return { affectedRows };
}
