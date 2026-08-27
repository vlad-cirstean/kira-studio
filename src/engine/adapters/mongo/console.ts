import { MONGO_CONSOLE_METHODS } from '@shared/domain/console';
import {
  createDocumentPageBuilder,
  type DocumentPage,
  type Page,
  type PagePosition,
} from '@shared/protocol/page';
import { EJSON } from 'bson';
import type { Collection, Db, Document } from 'mongodb';
import type { OpCtx } from '../adapter';
import { AdapterError, throwIfCancelled } from '../errors';
import { mapError } from './errors';
import { LiteralParser } from './literal';

// §8.14: "for non-SQL engines the console takes that engine's native command form" — Mongo's
// shell syntax `db.<collection>.<method>(<args>)`. D9's JSON5-lite parser (literal.ts) handles
// the argument list; this file owns the statement grammar and the per-method dispatch.

interface ParsedStatement {
  collection: string;
  method: string;
  args: unknown[];
}

// P18 addendum D21: built from the shared list, not a second literal copy — the renderer's
// console completion source reads the same list, so a method it offers can never be one this
// dispatch rejects.
const SUPPORTED_METHODS = new Set(MONGO_CONSOLE_METHODS);

function parseStatement(text: string): ParsedStatement {
  const parser = new LiteralParser(text.trim());
  parser.expectIdent('db');
  parser.expectPunct('.');
  const collection = parser.expectIdent();
  parser.expectPunct('.');
  const method = parser.expectIdent();
  if (!SUPPORTED_METHODS.has(method)) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `unsupported console method: db.${collection}.${method}()`,
    );
  }
  parser.expectPunct('(');
  const args: unknown[] = [];
  if (!parser.peekPunct(')')) {
    args.push(parser.parseValue());
    while (parser.peekPunct(',')) {
      parser.expectPunct(',');
      args.push(parser.parseValue());
    }
  }
  parser.expectPunct(')');
  if (!parser.atEnd()) {
    throw new AdapterError('E_QUERY', 'unexpected trailing content after statement');
  }
  return { collection, method, args };
}

function asDoc(value: unknown, label: string): Document {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdapterError('E_QUERY', `${label} must be a document literal`);
  }
  return value as Document;
}

function asDocArray(value: unknown, label: string): Document[] {
  if (!Array.isArray(value)) throw new AdapterError('E_QUERY', `${label} must be an array`);
  return value.map((v) => asDoc(v, label));
}

function docsToPage(docs: Document[]): DocumentPage {
  const builder = createDocumentPageBuilder();
  for (const doc of docs) {
    const id = doc._id !== undefined ? EJSON.stringify(doc._id, { relaxed: false }) : '';
    builder.push(id, EJSON.stringify(doc, { relaxed: false }));
  }
  const position: PagePosition = {
    offset: 0,
    pageSize: docs.length,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

// Console results that are an acknowledgement rather than a document set (insert/update/delete/
// count) — one status "document" per statement, mirroring mysql-family/console.ts's singleStatusPage.
function statusPage(status: Record<string, unknown>): DocumentPage {
  const builder = createDocumentPageBuilder();
  builder.push('', EJSON.stringify(status, { relaxed: false }));
  const position: PagePosition = {
    offset: 0,
    pageSize: 1,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

async function runStatement(
  db: Db,
  { collection: collectionName, method, args }: ParsedStatement,
  ctx: OpCtx,
): Promise<DocumentPage> {
  const collection: Collection = db.collection(collectionName);
  // Only find/findOne/countDocuments/aggregate support the driver's AbortSignal option
  // (Abortable) — insert/update/delete/replace do not, so `comment` (D7's killOp-fallback tag)
  // is the only thing every op below shares.
  const commentOnly = { comment: ctx.opId };
  const cancellable = { ...commentOnly, signal: ctx.signal };

  switch (method) {
    case 'find': {
      const filter = args[0] === undefined ? {} : asDoc(args[0], 'find() filter');
      const projection = args[1] === undefined ? undefined : asDoc(args[1], 'find() projection');
      const docs = await collection.find(filter, { ...cancellable, projection }).toArray();
      return docsToPage(docs);
    }
    case 'findOne': {
      const filter = args[0] === undefined ? {} : asDoc(args[0], 'findOne() filter');
      const doc = await collection.findOne(filter, cancellable);
      return docsToPage(doc ? [doc] : []);
    }
    case 'insertOne': {
      const doc = asDoc(args[0], 'insertOne() document');
      const result = await collection.insertOne(doc, commentOnly);
      return statusPage({ acknowledged: result.acknowledged, insertedId: result.insertedId });
    }
    case 'insertMany': {
      const docs = asDocArray(args[0], 'insertMany() documents');
      const result = await collection.insertMany(docs, commentOnly);
      return statusPage({ acknowledged: result.acknowledged, insertedCount: result.insertedCount });
    }
    case 'updateOne': {
      const filter = asDoc(args[0], 'updateOne() filter');
      const update = asDoc(args[1], 'updateOne() update');
      const result = await collection.updateOne(filter, update, commentOnly);
      return statusPage({
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId,
      });
    }
    case 'updateMany': {
      const filter = asDoc(args[0], 'updateMany() filter');
      const update = asDoc(args[1], 'updateMany() update');
      const result = await collection.updateMany(filter, update, commentOnly);
      return statusPage({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
    }
    case 'deleteOne': {
      const filter = args[0] === undefined ? {} : asDoc(args[0], 'deleteOne() filter');
      const result = await collection.deleteOne(filter, commentOnly);
      return statusPage({ deletedCount: result.deletedCount });
    }
    case 'deleteMany': {
      const filter = args[0] === undefined ? {} : asDoc(args[0], 'deleteMany() filter');
      const result = await collection.deleteMany(filter, commentOnly);
      return statusPage({ deletedCount: result.deletedCount });
    }
    case 'countDocuments': {
      const filter = args[0] === undefined ? {} : asDoc(args[0], 'countDocuments() filter');
      const count = await collection.countDocuments(filter, cancellable);
      return statusPage({ count });
    }
    case 'aggregate': {
      const pipeline = args[0] === undefined ? [] : asDocArray(args[0], 'aggregate() pipeline');
      const docs = await collection.aggregate(pipeline, cancellable).toArray();
      return docsToPage(docs);
    }
    default:
      throw new AdapterError(
        'E_UNSUPPORTED',
        `unsupported console method: db.${collectionName}.${method}()`,
      );
  }
}

// One op-log row for the whole batch (P5.5 D9's precedent, mirrored from mysql-family/console.ts).
export async function execute(db: Db, ctx: OpCtx, statements: string[]): Promise<Page[]> {
  if (statements.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  ctx.setCommand(statements.join(';\n'));

  const pages: Page[] = [];
  for (const text of statements) {
    throwIfCancelled(ctx);
    const parsed = parseStatement(text);
    try {
      pages.push(await runStatement(db, parsed, ctx));
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw mapError(err);
    }
  }
  return pages;
}
