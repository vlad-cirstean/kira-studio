import type { Adapter, OpCtx, ReadRequest } from '../../../src/engine/adapters/adapter';
import type { DocumentPage, TabularPage } from '../../../src/shared/protocol/page';

// P8 widened Adapter.read() to return the Page union (TabularPage | DocumentPage). Postgres and
// MariaDB are both tabular-only (mariadbCaps/postgresCaps: defaultPageKind: 'tabular') — every
// spec in this file expects a TabularPage back, so this narrows once instead of repeating the
// same `if (page.kind !== 'tabular') throw` at every one of postgres.spec.ts's/mariadb.spec.ts's
// call sites.
export async function readTabular(
  adapter: Adapter,
  req: ReadRequest,
  ctx: OpCtx,
): Promise<TabularPage> {
  const page = await adapter.read(req, ctx);
  if (page.kind !== 'tabular') {
    throw new Error(`expected a tabular page, got ${page.kind}`);
  }
  return page;
}

/** Mongo's counterpart — mongo.spec.ts is document-kind-only (mongoCaps.defaultPageKind). */
export async function readDocument(
  adapter: Adapter,
  req: ReadRequest,
  ctx: OpCtx,
): Promise<DocumentPage> {
  const page = await adapter.read(req, ctx);
  if (page.kind !== 'document') {
    throw new Error(`expected a document page, got ${page.kind}`);
  }
  return page;
}
