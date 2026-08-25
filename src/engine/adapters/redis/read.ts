import type { Redis } from 'ioredis';
import {
  createKeyValuePageBuilder,
  type KeyValuePage,
  type PagePosition,
} from '../../../shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import { decodePageToken, encodePageToken, requestFingerprint } from '../sql-text';
import { mapError } from './errors';

// Never an unbudgeted SCAN (ground rules) — same per-round-trip COUNT hint as catalog.ts.
const SCAN_COUNT = 1000;
const LIST_WINDOW = 500; // LRANGE window cap, mirrors MAX_PAGE_SIZE discipline

interface KeyMeta {
  redisType: KeyValuePage['redisType'] | 'none';
  ttlMs: number | null;
  memoryBytes: number | null;
}

const KNOWN_TYPES = new Set(['string', 'hash', 'list', 'set', 'zset', 'stream']);

async function readMeta(conn: Redis, key: string, ctx: OpCtx): Promise<KeyMeta> {
  let rawType: string;
  try {
    rawType = await conn.type(key);
  } catch (err) {
    throw mapError(err);
  }
  // A key gone at read time is an ordinary query-time condition (expired/deleted concurrently),
  // not a connection failure — E_QUERY, deliberately not E_NOT_FOUND (P9's D10).
  if (rawType === 'none') throw new AdapterError('E_QUERY', `key no longer exists: ${key}`);
  if (!KNOWN_TYPES.has(rawType)) {
    throw new AdapterError('E_UNSUPPORTED', `unsupported redis type for ${key}: ${rawType}`);
  }
  let pttl: number;
  try {
    pttl = await conn.pttl(key);
  } catch (err) {
    throw mapError(err);
  }
  let memoryBytes: number | null;
  try {
    memoryBytes = await conn.memory('USAGE', key);
  } catch {
    memoryBytes = null; // best-effort (§8.8)
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  return {
    redisType: rawType as KeyValuePage['redisType'],
    ttlMs: pttl >= 0 ? pttl : null,
    memoryBytes,
  };
}

async function readString(
  conn: Redis,
  key: string,
  meta: KeyMeta,
  ctx: OpCtx,
): Promise<KeyValuePage> {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  let value: string | null;
  try {
    value = await conn.get(key);
  } catch (err) {
    throw mapError(err);
  }
  const builder = createKeyValuePageBuilder({
    redisType: 'string',
    ttlMs: meta.ttlMs,
    memoryBytes: meta.memoryBytes,
  });
  if (value !== null) builder.push('value', value);
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

// Shared cursor-loop body for hash/set/zset (§8.8's per-type renderers): accumulates whole SCAN
// rounds without slicing mid-round, so a round's remaining elements are never dropped (P9's read
// notes) — the page can slightly overshoot req.pageSize, which is fine for a browse-only view.
async function readScanFamily(
  scanOnce: (cursor: string) => Promise<[string, string[]]>,
  pairSize: 1 | 2,
  redisType: KeyValuePage['redisType'],
  meta: KeyMeta,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
  fingerprint: string,
): Promise<KeyValuePage> {
  if (req.cursor.mode === 'before') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'redis cursor pagination is forward-only; there is no previous page',
    );
  }
  let cursor = '0';
  if (req.cursor.mode === 'after') {
    [cursor] = decodePageToken(req.cursor.token, fingerprint);
  }

  const builder = createKeyValuePageBuilder({
    redisType,
    ttlMs: meta.ttlMs,
    memoryBytes: meta.memoryBytes,
  });
  let rowCount = 0;
  let exhausted = false;

  do {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    const [nextCursor, elements] = await scanOnce(cursor);
    cursor = nextCursor;
    for (let i = 0; i < elements.length; i += pairSize) {
      if (pairSize === 2) builder.push(elements[i], elements[i + 1]);
      else builder.push(String(rowCount), elements[i]);
      rowCount++;
    }
    if (cursor === '0') exhausted = true;
  } while (rowCount < req.pageSize && !exhausted);

  const hasMore = !exhausted;
  const position: PagePosition = {
    offset: null,
    pageSize: req.pageSize,
    hasMore,
    nextToken: hasMore ? encodePageToken([cursor], fingerprint) : null,
    prevToken: null,
    strategy: 'cursor',
  };
  return builder.finish(position);
}

async function readHash(
  conn: Redis,
  key: string,
  meta: KeyMeta,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
  fingerprint: string,
): Promise<KeyValuePage> {
  return readScanFamily(
    async (cursor) => {
      try {
        return await conn.hscan(key, cursor, 'COUNT', SCAN_COUNT);
      } catch (err) {
        throw mapError(err);
      }
    },
    2,
    'hash',
    meta,
    req,
    ctx,
    fingerprint,
  );
}

async function readSet(
  conn: Redis,
  key: string,
  meta: KeyMeta,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
  fingerprint: string,
): Promise<KeyValuePage> {
  return readScanFamily(
    async (cursor) => {
      try {
        return await conn.sscan(key, cursor, 'COUNT', SCAN_COUNT);
      } catch (err) {
        throw mapError(err);
      }
    },
    1,
    'set',
    meta,
    req,
    ctx,
    fingerprint,
  );
}

async function readZSet(
  conn: Redis,
  key: string,
  meta: KeyMeta,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
  fingerprint: string,
): Promise<KeyValuePage> {
  return readScanFamily(
    async (cursor) => {
      try {
        return await conn.zscan(key, cursor, 'COUNT', SCAN_COUNT);
      } catch (err) {
        throw mapError(err);
      }
    },
    2,
    'zset',
    meta,
    req,
    ctx,
    fingerprint,
  );
}

async function readList(
  conn: Redis,
  key: string,
  meta: KeyMeta,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<KeyValuePage> {
  if (req.cursor.mode !== 'offset') {
    throw new AdapterError('E_UNSUPPORTED', 'redis list pagination only supports offset paging');
  }
  const offset = req.cursor.offset;
  const limit = Math.min(req.pageSize, LIST_WINDOW);
  let elements: string[];
  try {
    elements = await conn.lrange(key, offset, offset + limit - 1);
  } catch (err) {
    throw mapError(err);
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

  let total: number;
  try {
    total = await conn.llen(key);
  } catch (err) {
    throw mapError(err);
  }

  const builder = createKeyValuePageBuilder({
    redisType: 'list',
    ttlMs: meta.ttlMs,
    memoryBytes: meta.memoryBytes,
  });
  elements.forEach((value, i) => {
    builder.push(String(offset + i), value);
  });

  const hasMore = offset + elements.length < total;
  const position: PagePosition = {
    offset,
    pageSize: req.pageSize,
    hasMore,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

async function readStream(
  conn: Redis,
  key: string,
  meta: KeyMeta,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
  fingerprint: string,
): Promise<KeyValuePage> {
  if (req.cursor.mode === 'before') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'redis stream pagination is forward-only; there is no previous page',
    );
  }
  let startId = '-';
  if (req.cursor.mode === 'after') {
    const [afterId] = decodePageToken(req.cursor.token, fingerprint);
    startId = `(${afterId}`; // exclusive lower bound, per XRANGE syntax
  }

  const limit = req.pageSize + 1; // D24's +1 probe, mirroring the SQL adapters
  let entries: [id: string, fields: string[]][];
  try {
    entries = await conn.xrange(key, startId, '+', 'COUNT', limit);
  } catch (err) {
    throw mapError(err);
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

  const probedExtra = entries.length > req.pageSize;
  const kept = probedExtra ? entries.slice(0, req.pageSize) : entries;

  const builder = createKeyValuePageBuilder({
    redisType: 'stream',
    ttlMs: meta.ttlMs,
    memoryBytes: meta.memoryBytes,
  });
  for (const [id, fields] of kept) {
    const pairs: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) pairs[fields[i]] = fields[i + 1];
    builder.push(id, JSON.stringify(pairs));
  }

  const hasMore = probedExtra;
  const position: PagePosition = {
    offset: null,
    pageSize: req.pageSize,
    hasMore,
    nextToken: hasMore ? encodePageToken([kept[kept.length - 1][0]], fingerprint) : null,
    prevToken: null,
    strategy: 'cursor',
  };
  return builder.finish(position);
}

// D6: per-type dispatch after TYPE + PTTL + best-effort MEMORY USAGE classification.
export async function readKey(
  conn: Redis,
  key: string,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<KeyValuePage> {
  const meta = await readMeta(conn, key, ctx);
  ctx.setCommand(`TYPE ${key}`);
  const fingerprint = requestFingerprint({
    key,
    pageSize: req.pageSize,
    redisType: meta.redisType,
  });

  switch (meta.redisType) {
    case 'string':
      return readString(conn, key, meta, ctx);
    case 'hash':
      return readHash(conn, key, meta, req, ctx, fingerprint);
    case 'set':
      return readSet(conn, key, meta, req, ctx, fingerprint);
    case 'zset':
      return readZSet(conn, key, meta, req, ctx, fingerprint);
    case 'list':
      return readList(conn, key, meta, req, ctx);
    case 'stream':
      return readStream(conn, key, meta, req, ctx, fingerprint);
    default:
      throw new AdapterError(
        'E_UNSUPPORTED',
        `unsupported redis type for ${key}: ${meta.redisType}`,
      );
  }
}

// D6: exact via O(1) type-length commands — exactCount: true for a single key's count.
export async function countKey(
  conn: Redis,
  key: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }> {
  let rawType: string;
  try {
    rawType = await conn.type(key);
  } catch (err) {
    throw mapError(err);
  }
  if (rawType === 'none') throw new AdapterError('E_QUERY', `key no longer exists: ${key}`);
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

  try {
    switch (rawType) {
      case 'string':
        return { value: 1, exact: true };
      case 'hash':
        return { value: await conn.hlen(key), exact: true };
      case 'set':
        return { value: await conn.scard(key), exact: true };
      case 'zset':
        return { value: await conn.zcard(key), exact: true };
      case 'list':
        return { value: await conn.llen(key), exact: true };
      case 'stream':
        return { value: await conn.xlen(key), exact: true };
      default:
        throw new AdapterError('E_UNSUPPORTED', `unsupported redis type for ${key}: ${rawType}`);
    }
  } catch (err) {
    throw mapError(err);
  }
}
