import * as flatbuffers from 'flatbuffers';

import type {
  CacheStats,
  CountResponse,
  ExecuteResponse,
  MutateResponse,
  ObjectDownloadResponse,
  PreviewResponse,
  ReadResponse,
} from './data-ops';
import type {
  ColumnDescriptor,
  DocumentPage,
  KeyValuePage,
  Page,
  PagePosition,
  StreamPage,
  TabularPage,
  TextColumnChunk,
  TypeClass,
} from './page';
import type { PingPayload, PortEvent, PortResponse } from './port';
import * as wire from './wire';

// The renderer<->engine data plane's TypeScript end (P11): the mirror of Go's internal/page/
// encode.go and internal/adapterhost/frame.go. Every response, error and event frame this process
// receives comes through decodeFrame, which checks the "KIF1" file identifier and throws on
// anything else — there is no JSON fallback (AGENTS.md forbids a compatibility shim).

function decodeChunk(c: wire.Chunk): TextColumnChunk {
  const data = c.dataArray();
  const offsets = c.offsetsArray();
  const nulls = c.nullsArray();
  const truncated = c.truncatedArray();
  if (!data || !offsets || !nulls || !truncated) {
    throw new Error('frame: chunk is missing a buffer');
  }
  return { data, offsets, nulls, truncated };
}

// P5 C7/F8: decodeChunk's four arrays are views over the *whole received frame's* ArrayBuffer
// (P11 D4/D5's own zero-copy design) — holding one page's chunk therefore pins every byte of the
// frame it arrived in, siblings included. `.slice()` on a typed array copies into its own,
// exactly-sized buffer. Used only by the ExecuteResponse branch below, only when a frame carried
// more than one page — the case P11 OQ-1 named, where one page surviving console/state.ts's own
// releaseResult/evictOldestResults keeps every other page's bytes alive too, invisibly to
// totalRetainedBytes() (which sums page.byteSize, unaffected by sharing).
function copyChunk(c: TextColumnChunk): TextColumnChunk {
  return {
    data: c.data.slice(),
    offsets: c.offsets.slice(),
    nulls: c.nulls.slice(),
    truncated: c.truncated.slice(),
  };
}

function copyPageBuffers(page: Page): Page {
  switch (page.kind) {
    case 'tabular':
      return { ...page, chunks: page.chunks.map(copyChunk) };
    case 'document':
      return { ...page, ids: copyChunk(page.ids), bodies: copyChunk(page.bodies) };
    case 'keyvalue':
      return { ...page, fields: copyChunk(page.fields), values: copyChunk(page.values) };
    case 'stream':
      return {
        ...page,
        keys: copyChunk(page.keys),
        headers: copyChunk(page.headers),
        attrs: copyChunk(page.attrs),
        timestamps: copyChunk(page.timestamps),
        bodies: copyChunk(page.bodies),
      };
  }
}

function decodeColumnDescriptor(c: wire.ColumnDescriptor): ColumnDescriptor {
  const name = c.name();
  const dataType = c.dataType();
  if (name === null || dataType === null) {
    throw new Error('frame: ColumnDescriptor is missing a required field');
  }
  return {
    name,
    dataType,
    typeClass: decodeTypeClass(c.typeClass()),
    nullable: c.nullable(),
    isPrimaryKey: c.isPrimaryKey(),
    generated: c.generated(),
  };
}

function decodePosition(p: wire.PagePosition): PagePosition {
  return {
    offset: p.offset(),
    pageSize: p.pageSize(),
    hasMore: p.hasMore(),
    nextToken: p.nextToken(),
    prevToken: p.prevToken(),
    strategy: decodeStrategy(p.strategy()),
  };
}

function decodeTypeClass(t: wire.TypeClass): TypeClass {
  switch (t) {
    case wire.TypeClass.number:
      return 'number';
    case wire.TypeClass.text:
      return 'text';
    case wire.TypeClass.boolean:
      return 'boolean';
    case wire.TypeClass.temporal:
      return 'temporal';
    case wire.TypeClass.binary:
      return 'binary';
    case wire.TypeClass.json:
      return 'json';
    case wire.TypeClass.other:
      return 'other';
    default:
      throw new Error(`frame: decodeTypeClass: unknown TypeClass ${t}`);
  }
}

function decodeStrategy(s: wire.Strategy): PagePosition['strategy'] {
  switch (s) {
    case wire.Strategy.keyset:
      return 'keyset';
    case wire.Strategy.offset:
      return 'offset';
    case wire.Strategy.cursor:
      return 'cursor';
    case wire.Strategy.offsetWindow:
      return 'offsetWindow';
    case wire.Strategy.batch:
      return 'batch';
    default:
      throw new Error(`frame: decodeStrategy: unknown Strategy ${s}`);
  }
}

// decodeRedisType maps the wire enum's string_/set_ members (wire.fbs suffixes those two to dodge
// a reserved-word collision in generated TypeScript) back onto page.ts's plain "string"/"set"
// literals — the mirror of Go's encode.go encodeRedisType.
function decodeRedisType(t: wire.RedisType): KeyValuePage['redisType'] {
  switch (t) {
    case wire.RedisType.string_:
      return 'string';
    case wire.RedisType.hash:
      return 'hash';
    case wire.RedisType.list:
      return 'list';
    case wire.RedisType.set_:
      return 'set';
    case wire.RedisType.zset:
      return 'zset';
    case wire.RedisType.stream:
      return 'stream';
    case wire.RedisType.object:
      return 'object';
    default:
      throw new Error(`frame: decodeRedisType: unknown RedisType ${t}`);
  }
}

function decodeSource(s: wire.Source): ReadResponse['source'] {
  switch (s) {
    case wire.Source.cache:
      return 'cache';
    case wire.Source.server:
      return 'server';
    default:
      throw new Error(`frame: decodeSource: unknown Source ${s}`);
  }
}

function decodeTabularPage(t: wire.TabularPage): TabularPage {
  const columns: ColumnDescriptor[] = [];
  for (let i = 0; i < t.columnsLength(); i++) {
    const c = t.columns(i);
    if (!c) throw new Error('frame: TabularPage.columns is missing an entry');
    columns.push(decodeColumnDescriptor(c));
  }
  const chunks: TextColumnChunk[] = [];
  for (let i = 0; i < t.chunksLength(); i++) {
    const c = t.chunks(i);
    if (!c) throw new Error('frame: TabularPage.chunks is missing an entry');
    chunks.push(decodeChunk(c));
  }
  const position = t.position();
  if (!position) throw new Error('frame: TabularPage.position is missing');
  return {
    kind: 'tabular',
    columns,
    rowCount: t.rowCount(),
    chunks,
    position: decodePosition(position),
    truncatedCells: t.truncatedCells(),
    byteSize: t.byteSize(),
    fetchedAt: t.fetchedAt(),
  };
}

function decodeDocumentPage(d: wire.DocumentPage): DocumentPage {
  const position = d.position();
  const ids = d.ids();
  const bodies = d.bodies();
  if (!position || !ids || !bodies) {
    throw new Error('frame: DocumentPage is missing a required field');
  }
  return {
    kind: 'document',
    position: decodePosition(position),
    ids: decodeChunk(ids),
    bodies: decodeChunk(bodies),
    rowCount: d.rowCount(),
    byteSize: d.byteSize(),
    fetchedAt: d.fetchedAt(),
  };
}

function decodeKeyValuePage(k: wire.KeyValuePage): KeyValuePage {
  const position = k.position();
  const fields = k.fields();
  const values = k.values();
  if (!position || !fields || !values) {
    throw new Error('frame: KeyValuePage is missing a required field');
  }
  return {
    kind: 'keyvalue',
    position: decodePosition(position),
    redisType: decodeRedisType(k.redisType()),
    ttlMs: k.ttlMs(),
    memoryBytes: k.memoryBytes(),
    fields: decodeChunk(fields),
    values: decodeChunk(values),
    rowCount: k.rowCount(),
    byteSize: k.byteSize(),
    fetchedAt: k.fetchedAt(),
  };
}

function decodeStreamPage(s: wire.StreamPage): StreamPage {
  const position = s.position();
  const keys = s.keys();
  const headers = s.headers();
  const attrs = s.attrs();
  const timestamps = s.timestamps();
  const bodies = s.bodies();
  if (!position || !keys || !headers || !attrs || !timestamps || !bodies) {
    throw new Error('frame: StreamPage is missing a required field');
  }
  return {
    kind: 'stream',
    position: decodePosition(position),
    keys: decodeChunk(keys),
    headers: decodeChunk(headers),
    attrs: decodeChunk(attrs),
    timestamps: decodeChunk(timestamps),
    bodies: decodeChunk(bodies),
    rowCount: s.rowCount(),
    byteSize: s.byteSize(),
    fetchedAt: s.fetchedAt(),
    visibilityTimeoutSeconds: s.visibilityTimeoutSeconds(),
  };
}

function decodePage(p: wire.Page): Page {
  const bodyType = p.bodyType();
  switch (bodyType) {
    case wire.PageBody.TabularPage: {
      const body: wire.TabularPage | null = p.body(new wire.TabularPage());
      if (!body) throw new Error('frame: Page.body is missing (TabularPage)');
      return decodeTabularPage(body);
    }
    case wire.PageBody.DocumentPage: {
      const body: wire.DocumentPage | null = p.body(new wire.DocumentPage());
      if (!body) throw new Error('frame: Page.body is missing (DocumentPage)');
      return decodeDocumentPage(body);
    }
    case wire.PageBody.KeyValuePage: {
      const body: wire.KeyValuePage | null = p.body(new wire.KeyValuePage());
      if (!body) throw new Error('frame: Page.body is missing (KeyValuePage)');
      return decodeKeyValuePage(body);
    }
    case wire.PageBody.StreamPage: {
      const body: wire.StreamPage | null = p.body(new wire.StreamPage());
      if (!body) throw new Error('frame: Page.body is missing (StreamPage)');
      return decodeStreamPage(body);
    }
    default:
      throw new Error(`frame: decodePage: unhandled PageBody ${bodyType}`);
  }
}

function decodePayload(frame: wire.Frame): unknown {
  const type = frame.payloadType();
  switch (type) {
    case wire.Payload.NONE:
      return undefined;

    case wire.Payload.ReadResponse: {
      const r: wire.ReadResponse | null = frame.payload(new wire.ReadResponse());
      if (!r) throw new Error('frame: ReadResponse payload is missing');
      const page = r.page();
      if (!page) throw new Error('frame: ReadResponse.page is missing');
      const readResponse: ReadResponse = {
        page: decodePage(page),
        source: decodeSource(r.source()),
      };
      return readResponse;
    }

    case wire.Payload.CountResponse: {
      const r: wire.CountResponse | null = frame.payload(new wire.CountResponse());
      if (!r) throw new Error('frame: CountResponse payload is missing');
      const countResponse: CountResponse = {
        value: r.value(),
        exact: r.exact(),
        at: r.at(),
        stale: r.stale(),
        source: decodeSource(r.source()),
      };
      return countResponse;
    }

    case wire.Payload.PreviewResponse: {
      const r: wire.PreviewResponse | null = frame.payload(new wire.PreviewResponse());
      if (!r) throw new Error('frame: PreviewResponse payload is missing');
      const statements: string[] = [];
      for (let i = 0; i < r.statementsLength(); i++) statements.push(r.statements(i));
      const previewResponse: PreviewResponse = { statements };
      return previewResponse;
    }

    case wire.Payload.MutateResponse: {
      const r: wire.MutateResponse | null = frame.payload(new wire.MutateResponse());
      if (!r) throw new Error('frame: MutateResponse payload is missing');
      const mutateResponse: MutateResponse = { affectedRows: r.affectedRows() };
      return mutateResponse;
    }

    case wire.Payload.ExecuteResponse: {
      const r: wire.ExecuteResponse | null = frame.payload(new wire.ExecuteResponse());
      if (!r) throw new Error('frame: ExecuteResponse payload is missing');
      // C7/F8: only a multi-page frame can pin a sibling page's bytes by sharing its buffer — a
      // single-page execute (the common case) stays zero-copy, byte-for-byte what P11 shipped.
      const copyBuffers = r.pagesLength() > 1;
      const pages: Page[] = [];
      for (let i = 0; i < r.pagesLength(); i++) {
        const p = r.pages(i);
        if (!p) throw new Error('frame: ExecuteResponse.pages is missing an entry');
        const page = decodePage(p);
        pages.push(copyBuffers ? copyPageBuffers(page) : page);
      }
      const executeResponse: ExecuteResponse = { pages };
      return executeResponse;
    }

    case wire.Payload.ObjectDownloadResponse: {
      const r: wire.ObjectDownloadResponse | null = frame.payload(
        new wire.ObjectDownloadResponse(),
      );
      if (!r) throw new Error('frame: ObjectDownloadResponse payload is missing');
      const objectDownloadResponse: ObjectDownloadResponse = { bytes: r.bytes() };
      return objectDownloadResponse;
    }

    case wire.Payload.PingPayload: {
      const r: wire.PingPayload | null = frame.payload(new wire.PingPayload());
      if (!r) throw new Error('frame: PingPayload payload is missing');
      const pingPayload: PingPayload = { pong: true, enginePid: r.enginePid(), at: r.at() };
      return pingPayload;
    }

    case wire.Payload.CacheStats: {
      const r: wire.CacheStats | null = frame.payload(new wire.CacheStats());
      if (!r) throw new Error('frame: CacheStats payload is missing');
      const cacheStats: CacheStats = {
        l2Bytes: r.l2Bytes(),
        l2BudgetBytes: r.l2BudgetBytes(),
        l2Entries: r.l2Entries(),
        l2Hits: r.l2Hits(),
        l2Misses: r.l2Misses(),
        l3Entries: r.l3Entries(),
      };
      return cacheStats;
    }

    case wire.Payload.EmptyResponse:
      return {};

    default:
      throw new Error(`frame: decodePayload: unhandled Payload ${type}`);
  }
}

/**
 * The one entry point port.ts calls on every inbound message: checks the "KIF1" file identifier
 * (throws on anything else — a mismatched identifier means the two ends disagree about the wire
 * format, not a recoverable per-message error) and decodes the frame into the same
 * PortResponse/PortEvent shapes handleMessage already expects.
 */
export function decodeFrame(bytes: Uint8Array): PortResponse | PortEvent {
  const bb = new flatbuffers.ByteBuffer(bytes);
  if (!wire.Frame.bufferHasIdentifier(bb)) {
    throw new Error('frame: buffer is missing the "KIF1" file identifier');
  }
  const frame = wire.Frame.getRootAsFrame(bb);
  const kind = frame.kind();

  if (kind === wire.FrameKind.evt) {
    const topic = frame.topic();
    if (topic === null) throw new Error('frame: event frame is missing its topic');
    return { kind: 'evt', topic, payload: decodePayload(frame) };
  }
  if (kind !== wire.FrameKind.res) {
    throw new Error(`frame: decodeFrame: unhandled FrameKind ${kind}`);
  }

  const id = frame.id();
  if (frame.ok()) {
    return { kind: 'res', id, ok: true, payload: decodePayload(frame) };
  }
  const err = frame.error();
  if (!err) throw new Error('frame: !ok response is missing its error');
  const message = err.message();
  if (message === null) throw new Error('frame: error is missing its message');
  const code = err.code();
  return { kind: 'res', id, ok: false, error: code === null ? { message } : { message, code } };
}
