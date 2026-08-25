import { EJSON } from 'bson';
import type { Abortable, Db, Document, Filter, FindOptions } from 'mongodb';
import {
  createDocumentPageBuilder,
  type DocumentPage,
  type PagePosition,
} from '../../../shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import { decodePageToken, encodePageToken, requestFingerprint, safeInt } from '../sql-text';
import { mapError } from './errors';
import { parseFilterObject } from './literal';

function idText(doc: Document): string {
  return EJSON.stringify(doc._id, { relaxed: false });
}

// D6: `_id`-keyset when the request is unsorted or sorted purely by `_id`; `skip`/`limit`
// fallback for any other sort (§5.1's literal wording).
export async function readPage(
  db: Db,
  collectionName: string,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<DocumentPage> {
  if (req.sort?.kind === 'text') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'a free-text sort expression is not supported for mongodb',
    );
  }
  const collection = db.collection(collectionName);
  const baseFilter = parseFilterObject(req.filter);
  const sortTerms = req.sort?.kind === 'structured' ? req.sort.terms : [];
  const idOnlySort =
    sortTerms.length === 0 || (sortTerms.length === 1 && sortTerms[0].column === '_id');
  const direction = sortTerms[0]?.direction ?? 'asc';
  const wantsKeyset = req.cursor.mode === 'after' || req.cursor.mode === 'before';

  if (wantsKeyset && !idOnlySort) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'keyset pagination is unavailable for this sort; the client must use an offset cursor',
    );
  }

  const fingerprint = requestFingerprint({
    path: collectionName,
    filter: req.filter,
    sort: req.sort,
    pageSize: req.pageSize,
  });

  const reverseRows = req.cursor.mode === 'before' && idOnlySort;
  const mongoDirection: 1 | -1 = direction === 'asc' ? 1 : -1;
  const scanDirection: 1 | -1 = reverseRows ? (mongoDirection === 1 ? -1 : 1) : mongoDirection;

  let filter: Filter<Document> = baseFilter as Filter<Document>;
  if (idOnlySort && wantsKeyset && req.cursor.mode !== 'offset') {
    const [rawId] = decodePageToken(req.cursor.token, fingerprint);
    let boundaryId: unknown;
    try {
      boundaryId = EJSON.parse(rawId);
    } catch {
      throw new AdapterError('E_QUERY', 'malformed page token');
    }
    // The comparison operator tracks the scan's own direction, not which user-facing request
    // ('after'/'before') caused it — a 'before' request already flips scanDirection (above) to
    // scan toward the boundary from the near side, then reverses the result back to ascending
    // display order below.
    const op = scanDirection === 1 ? '$gt' : '$lt';
    filter = {
      ...baseFilter,
      _id: { ...(baseFilter._id as object | undefined), [op]: boundaryId },
    } as Filter<Document>;
  }

  const limit = safeInt(req.pageSize + 1, 'page size'); // D24's +1 probe, mirroring the SQL adapters
  const findOptions: FindOptions & Abortable = { limit, signal: ctx.signal, comment: ctx.opId };
  // `req.projection` is the generic `ReadRequest` field every adapter shares (Adapter rule 7's
  // relational precedent) — Mongo's own shape for "return a field subset" is a `find()` options
  // projection document, `{ field: 1, ... }`. `_id` is never listed here even when the caller
  // omitted it from the picker: an inclusion projection returns `_id` by default unless it is
  // explicitly excluded (`_id: 0`), and this adapter never sends that exclusion, so the document's
  // identity always survives regardless of which fields the UI's picker has checked.
  if (req.projection && req.projection.length > 0) {
    findOptions.projection = Object.fromEntries(req.projection.map((field) => [field, 1]));
  }
  if (idOnlySort) {
    findOptions.sort = { _id: scanDirection };
  } else if (sortTerms.length > 0) {
    findOptions.sort = Object.fromEntries(
      sortTerms.map((t) => [t.column, t.direction === 'asc' ? 1 : -1]),
    );
  }
  if (!idOnlySort && req.cursor.mode === 'offset') {
    findOptions.skip = safeInt(req.cursor.offset, 'offset');
  }

  ctx.setCommand(`db.${collectionName}.find(${EJSON.stringify(filter)})`);

  let docs: Document[];
  try {
    docs = await collection.find(filter, findOptions).toArray();
  } catch (err) {
    throw mapError(err);
  }

  const probedExtra = docs.length > req.pageSize;
  const keptDocs = probedExtra ? docs.slice(0, req.pageSize) : docs;
  const displayDocs = reverseRows ? [...keptDocs].reverse() : keptDocs;
  const rowCount = displayDocs.length;

  const builder = createDocumentPageBuilder();
  for (const doc of displayDocs) {
    builder.push(idText(doc), EJSON.stringify(doc, { relaxed: false }));
  }

  const strategy: PagePosition['strategy'] = idOnlySort ? 'keyset' : 'offset';
  const hasMore = rowCount === 0 ? false : req.cursor.mode === 'before' ? true : probedExtra;

  let nextToken: string | null = null;
  let prevToken: string | null = null;
  if (idOnlySort && rowCount > 0) {
    const hasForward = req.cursor.mode === 'before' ? true : probedExtra;
    const hasBackward =
      req.cursor.mode === 'before'
        ? probedExtra
        : req.cursor.mode === 'after'
          ? true
          : req.cursor.offset > 0;
    if (hasForward) nextToken = encodePageToken([idText(displayDocs[rowCount - 1])], fingerprint);
    if (hasBackward) prevToken = encodePageToken([idText(displayDocs[0])], fingerprint);
  }

  const position: PagePosition = {
    offset: req.cursor.mode === 'offset' ? req.cursor.offset : null,
    pageSize: req.pageSize,
    hasMore,
    nextToken,
    prevToken,
    strategy,
  };

  return builder.finish(position);
}

// D5: estimatedDocumentCount() by default (Caps.count === 'estimate-only'); countDocuments()
// (exact) only when the caller passes a non-empty filter or explicitly asks for it — an
// unfiltered estimate is what the pager wants by default, but an estimate ignores any filter
// entirely, so a filtered count must always go through the exact (slow) path.
export async function countRows(
  db: Db,
  collectionName: string,
  filter: string | null,
  ctx: OpCtx,
  opts?: { exact?: boolean },
): Promise<{ value: number; exact: boolean }> {
  const collection = db.collection(collectionName);
  const parsedFilter = parseFilterObject(filter);
  const wantsExact = opts?.exact === true || (filter !== null && filter.trim() !== '');
  try {
    if (wantsExact) {
      const value = await collection.countDocuments(parsedFilter, {
        signal: ctx.signal,
        comment: ctx.opId,
      });
      return { value, exact: true };
    }
    // estimatedDocumentCount() has no AbortSignal support in the driver (unlike countDocuments,
    // find, findOne, aggregate) — it is a single fast metadata command, so this is not a gap in
    // D7's cancel coverage in practice.
    const value = await collection.estimatedDocumentCount();
    return { value, exact: false };
  } catch (err) {
    throw mapError(err);
  }
}
