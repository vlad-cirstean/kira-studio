import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import {
  createDocumentPageBuilder,
  createKeyValuePageBuilder,
  createStreamPageBuilder,
  createTabularPageBuilder,
  pageByteSize,
  type TextColumnChunk,
  type Page as WirePage,
} from '@shared/protocol/page';
import type { LogicalPage, LogicalPortResponse, PortSnapshot } from '../../ipc/support/types';

export interface SeenPortRequest {
  op: string;
  payload: unknown;
}

export interface MockStreamHandle {
  /** Every `PortRequest` the UI actually issued, in order — ported from
   *  `tests/ipc/support/mockPort.ts`'s `MockPortHandle.ops()` (P50 D7). */
  ops(): Promise<SeenPortRequest[]>;
}

/** What the injected browser script actually needs per snapshot: the request-matching key
 *  (`op`/`payload`) plus an already-encoded response, so the browser has nothing left to build
 *  (P11 C2 — moved here from `mockStreamBrowser.js` so page construction can go through the real
 *  `@shared/protocol/page` builders instead of a hand-rolled offsets loop, P50 D6). */
interface PreparedPortSnapshot {
  op: string;
  payload: unknown;
  wireResponse?: unknown;
  error?: { code: string; message: string };
  delayMs?: number;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

// page.Uint32LE.MarshalJSON's contract (internal/page/chunk.go): base64 of the little-endian
// bytes of a Uint32Array, not of decimal digits — a Uint32Array's buffer is little-endian on
// every platform this app targets.
function toWireChunk(chunk: TextColumnChunk) {
  return {
    data: toBase64(chunk.data),
    offsets: toBase64(
      new Uint8Array(chunk.offsets.buffer, chunk.offsets.byteOffset, chunk.offsets.byteLength),
    ),
    nulls: toBase64(chunk.nulls),
    truncated: toBase64(
      new Uint8Array(
        chunk.truncated.buffer,
        chunk.truncated.byteOffset,
        chunk.truncated.byteLength,
      ),
    ),
  };
}

function toWirePage(page: WirePage): unknown {
  if (page.kind === 'tabular') return { ...page, chunks: page.chunks.map(toWireChunk) };
  if (page.kind === 'document') {
    return { ...page, ids: toWireChunk(page.ids), bodies: toWireChunk(page.bodies) };
  }
  if (page.kind === 'keyvalue') {
    return { ...page, fields: toWireChunk(page.fields), values: toWireChunk(page.values) };
  }
  return {
    ...page,
    keys: toWireChunk(page.keys),
    headers: toWireChunk(page.headers),
    attrs: toWireChunk(page.attrs),
    timestamps: toWireChunk(page.timestamps),
    bodies: toWireChunk(page.bodies),
  };
}

function buildPage(logical: LogicalPage): WirePage {
  if (logical.kind === 'tabular') {
    const builder = createTabularPageBuilder(logical.columns);
    for (const row of logical.rows) builder.appendRow(row);
    const page = builder.finish(logical.position);
    if (logical.truncatedRows) {
      logical.truncatedRows.forEach((rows, i) => {
        if (rows) page.chunks[i].truncated = new Uint32Array(rows);
      });
      page.byteSize = pageByteSize(page);
    }
    return page;
  }
  if (logical.kind === 'document') {
    const builder = createDocumentPageBuilder();
    for (let i = 0; i < logical.ids.length; i++) {
      builder.push(logical.ids[i] ?? '', logical.bodies[i] ?? '');
    }
    return builder.finish(logical.position);
  }
  if (logical.kind === 'keyvalue') {
    const builder = createKeyValuePageBuilder({
      redisType: logical.redisType,
      ttlMs: logical.ttlMs,
      memoryBytes: logical.memoryBytes,
    });
    for (let i = 0; i < logical.fields.length; i++) {
      builder.push(logical.fields[i] ?? '', logical.values[i] ?? '');
    }
    return builder.finish(logical.position);
  }
  const builder = createStreamPageBuilder({
    visibilityTimeoutSeconds: logical.visibilityTimeoutSeconds,
  });
  for (let i = 0; i < logical.keys.length; i++) {
    builder.push({
      key: logical.keys[i],
      headers: logical.headers[i] ?? '',
      attrs: logical.attrs[i] ?? '',
      timestamp: logical.timestamps[i],
      body: logical.bodies[i] ?? '',
    });
  }
  return builder.finish(logical.position);
}

function buildResponsePayload(response: LogicalPortResponse): unknown {
  if (response.kind === 'read') {
    return { page: toWirePage(buildPage(response.page)), source: response.source };
  }
  if (response.kind === 'count') {
    return {
      value: response.value,
      exact: response.exact,
      at: Date.now(),
      stale: response.stale,
      source: response.source,
    };
  }
  if (response.kind === 'mutate') return { affectedRows: response.affectedRows };
  if (response.kind === 'preview') return { statements: response.statements };
  if (response.kind === 'execute') {
    return { pages: response.pages.map((p) => toWirePage(buildPage(p))) };
  }
  return {};
}

function prepareSnapshot(snap: PortSnapshot): PreparedPortSnapshot {
  return {
    op: snap.op,
    payload: snap.payload,
    wireResponse: snap.response ? buildResponsePayload(snap.response) : undefined,
    error: snap.error,
    delayMs: snap.delayMs,
  };
}

// Read once, not per call: `installMockStream` runs at least once per test. `bun run format`
// (biome) reformats mockStreamBrowser.js like any other tracked file, including appending a
// trailing `;` after its top-level expression statement — stripped here so wrapping it in a call
// (`(${BROWSER_SCRIPT})(...)`, below) stays valid regardless of which way the formatter last
// touched it.
const BROWSER_SCRIPT = readFileSync(resolve(__dirname, 'mockStreamBrowser.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

/**
 * Replaces the bulk-data transport from the renderer side (P57 D14) by installing
 * `window._wails.streamFactory` — `@wailsio/runtime`'s `stream.js` calls this synchronously
 * inside `Stream(name)` if it exists, in preference to opening a real connection
 * (`stream.js`: *"Server builds install a factory returning a real WebSocket… both objects present
 * the same interface, so nothing above this line cares which it is"*). `bridge/port.ts` calls
 * `JSONStream('engine')` at its own module scope, so this must be installed via
 * `page.addInitScript` — before any page script runs, on every navigation — never `page.evaluate`,
 * which would race the app's own module graph.
 *
 * Every snapshot's response is pre-built here, through the real `@shared/protocol/page` builders,
 * and shipped to the browser already encoded (P11 C2) — `mockStreamBrowser.js` just forwards
 * `wireResponse` verbatim and has no page-construction logic of its own. The socket shim itself
 * still lives in `mockStreamBrowser.js`, a plain, uncompiled JS file injected as a **string**, not
 * `page.addInitScript(fn, arg)` — see that file's own doc comment for why a typed function does
 * not survive the round trip here (a `keepNames` artefact common to every esbuild-based TS loader
 * this repo's tooling runs under).
 */
export async function installMockStream(
  page: Page,
  snapshots: readonly PortSnapshot[],
): Promise<MockStreamHandle> {
  const prepared = snapshots.map(prepareSnapshot);
  await page.addInitScript(`(${BROWSER_SCRIPT})(${JSON.stringify(prepared)});`);

  return {
    ops: () =>
      page.evaluate(
        () => (globalThis as unknown as { __kiraStreamSeen: SeenPortRequest[] }).__kiraStreamSeen,
      ),
  };
}
