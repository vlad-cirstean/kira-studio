import type { MutationPlan } from '@shared/domain/mutations';
import type { ObjectDownloadRequest } from '@shared/domain/object-store';
import { decodePath } from '@shared/domain/tree';
import {
  type CountRequestWire,
  type CountResponse,
  countRequestWireSchema,
  type ExecuteRequestWire,
  type ExecuteResponse,
  executeRequestWireSchema,
  type MutateRequestWire,
  type MutateResponse,
  mutateRequestWireSchema,
  type ObjectDownloadRequestWire,
  type ObjectDownloadResponse,
  objectDownloadRequestWireSchema,
  type PreviewRequestWire,
  type PreviewResponse,
  previewRequestWireSchema,
  type ReadRequestWire,
  type ReadResponse,
  readRequestWireSchema,
} from '@shared/protocol/data-ops';
import type { Page } from '@shared/protocol/page';
import { AdapterError } from './adapters/errors';
import { getLiveAdapter } from './adapters/live';
import { cache, pageCacheKey } from './cache';
import { runOp } from './scheduler/ops';

// The phase's hot path (§4c). A cache hit is not a database operation and must not appear in
// the op log — P1's tree spec established exactly that contract for L1, and P2's specs assert
// it again for L2.
export async function handleRead(
  payload: unknown,
): Promise<{ response: ReadResponse; page: Page }> {
  const req: ReadRequestWire = readRequestWireSchema.parse(payload);
  const { key, label } = pageCacheKey(req);

  const cached = cache.readPage(key);
  if (cached) {
    return { response: { page: cached, source: 'cache' }, page: cached };
  }

  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    // The renderer turns this into the tab's Reconnect & load affordance.
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const { value: page } = await runOp(
    { connectionId: req.connectionId, kind: 'read', opId: req.opId, tabId: req.tabId },
    async (ctx) => {
      const page = await adapter.read(
        {
          path,
          projection: req.projection,
          filter: req.filter,
          sort: req.sort,
          pageSize: req.pageSize,
          cursor: req.cursor,
        },
        ctx,
      );
      ctx.setRows(page.rowCount);
      return page;
    },
  );

  cache.storePage(key, label, req, page);
  return { response: { page, source: 'server' }, page };
}

export async function handleCount(payload: unknown): Promise<CountResponse> {
  const req: CountRequestWire = countRequestWireSchema.parse(payload);

  // The renderer's explicit refresh affordance on a stale count (§7, P13 D18) asks for a fresh
  // number — serving it the same stale cache entry it is asking to replace would be a no-op.
  const cached = req.refresh ? undefined : cache.count(req.connectionId, req.path, req.filter);
  if (cached) {
    return {
      value: cached.value,
      exact: cached.exact,
      at: cached.at,
      stale: cached.stale,
      source: 'cache',
    };
  }

  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const { value } = await runOp(
    { connectionId: req.connectionId, kind: 'count', opId: req.opId, tabId: req.tabId },
    async (ctx) => {
      const result = await adapter.count({ path, filter: req.filter }, ctx);
      ctx.setRows(result.value);
      return result;
    },
  );

  cache.storeCount(req.connectionId, req.path, req.filter, value.value, value.exact);
  return { value: value.value, exact: value.exact, at: Date.now(), stale: false, source: 'server' };
}

// D14: never ships bytes. Reuses handleRead's cache-aside logic entirely (a separate cache
// probe here would double-count the miss in L2's hit/miss stats) and derives `warmed`/`bytes`
// from whether the read actually hit the server.
// Never a database operation (P5 D9, same class as configureCache) — adapter.preview() is
// synchronous and never touches the server, so this never reaches the op log.
export async function handlePreview(payload: unknown): Promise<PreviewResponse> {
  const req: PreviewRequestWire = previewRequestWireSchema.parse(payload);
  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }
  const plan: MutationPlan = { path: decodePath(req.connectionId, req.path), ops: req.ops };
  return { statements: adapter.preview(plan) };
}

export async function handleMutate(payload: unknown): Promise<MutateResponse> {
  const req: MutateRequestWire = mutateRequestWireSchema.parse(payload);
  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const plan: MutationPlan = { path, ops: req.ops };
  try {
    const { value } = await runOp(
      { connectionId: req.connectionId, kind: 'mutate', opId: req.opId, tabId: req.tabId },
      (ctx) => adapter.mutate(plan, ctx),
    );
    return { affectedRows: value.affectedRows };
  } finally {
    // Same-process, not a round trip back through main (P5 D12). §7/P13 D18: a mutation drops
    // the target's pages but only marks its counts stale — DATA_OP.invalidate's hard drop is
    // reserved for the renderer's explicit ↻ Refresh.
    // P43 F12/D17: in a `finally`, not just the success path — redis/s3/sqs/rabbitmq/mongo/
    // clickhouse's own `mutate()` is a plain sequential loop with no transaction (unlike
    // postgres/mysql-family/sqlite's own BEGIN/COMMIT/ROLLBACK), so a plan that fails part-way
    // through still mutates the server. Leaving the success-only call meant that partial write
    // left its pre-mutation page cached as a hit, silently wrong until the user happened to press
    // Refresh. Dropping pages a transactional adapter's own rollback already left correct costs
    // one extra re-read; keeping pages a partial failure left wrong is the bug this fixes — the
    // asymmetry decides it (D18: the six adapters are not made transactional here).
    cache.invalidateAfterMutation(req.connectionId, req.path);
  }
}

// P33: no cache interaction at all — a download reads nothing the L1/L2 cache holds (it streams
// bytes to a local file, never a Page), and never returns bytes over the port (§4: bulk data
// never transits main or the renderer — the engine writes the file itself). 'transfer' rather
// than 'read' as the op kind (D9) so a multi-hundred-MB download reads as a file transfer in the
// Operations panel, not a mysteriously slow read.
export async function handleObjectDownload(payload: unknown): Promise<ObjectDownloadResponse> {
  const req: ObjectDownloadRequestWire = objectDownloadRequestWireSchema.parse(payload);
  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const downloadReq: ObjectDownloadRequest = { path, destPath: req.destPath };
  const { value } = await runOp(
    { connectionId: req.connectionId, kind: 'transfer', opId: req.opId, tabId: req.tabId },
    (ctx) => adapter.downloadObject(downloadReq, ctx),
  );
  return { bytes: value.bytes };
}

// §8.14: no cache interaction at all — console results never populate L2 (they are not a table
// page) and running a statement here does not auto-invalidate any data tab's cache (the adapter
// has no reliable way to know which table free-form SQL touched); the user's own ↻ still works.
export async function handleExecute(payload: unknown): Promise<ExecuteResponse> {
  const req: ExecuteRequestWire = executeRequestWireSchema.parse(payload);
  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const { value: pages } = await runOp(
    { connectionId: req.connectionId, kind: 'execute', opId: req.opId, tabId: req.tabId },
    async (ctx) => {
      const pages = await adapter.execute({ path, statements: req.statements }, ctx);
      ctx.setRows(pages.reduce((sum, p) => sum + p.rowCount, 0));
      return pages;
    },
  );
  return { pages };
}
