import type { Page } from '@playwright/test';
import type { PortSnapshot } from './types';

export interface SeenPortRequest {
  op: string;
  payload: unknown;
}

export interface MockPortHandle {
  /** Every `PortRequest` the UI actually issued, in order — a capability no full-stack spec in
   *  this repo has today (P50 D7): with the port mocked, the request itself is observable, not
   *  only whatever it rendered. */
  ops(): Promise<SeenPortRequest[]>;
}

/**
 * Replaces the bulk-data `MessagePort` from the renderer side (P50 D4), by posting a fresh
 * `MessageChannel`'s `port1` through the same `{ __kira: 'port' }` door
 * `renderer/bridge/port.ts` already listens on for a renderer reload or an engine restart (F6).
 *
 * **Must be called after the last `page.reload()`/navigation** — `main/index.ts` re-attaches a
 * real port on every `did-finish-load`, so a mock installed before a later reload is silently
 * replaced (F6's ordering fact). Call this last, then never reload again.
 *
 * The `page.evaluate` body below is intentionally self-contained: Playwright serialises only the
 * top-level function's own source, not anything it would otherwise close over, so the chunk
 * encoder is a nested function rather than an import from `@shared/protocol/page` (P50 §2.3).
 */
export async function installMockPort(
  page: Page,
  snapshots: readonly PortSnapshot[],
): Promise<MockPortHandle> {
  await page.evaluate((snaps: PortSnapshot[]) => {
    function encodeChunk(values: (string | null)[]) {
      const encoder = new TextEncoder();
      const encoded = values.map((v) => (v === null ? new Uint8Array(0) : encoder.encode(v)));
      let total = 0;
      for (const e of encoded) total += e.length;
      const data = new Uint8Array(total);
      const offsets = new Uint32Array(values.length + 1);
      const nulls = new Uint8Array(Math.ceil(values.length / 8));
      let cursor = 0;
      for (let i = 0; i < values.length; i++) {
        data.set(encoded[i], cursor);
        cursor += encoded[i].length;
        offsets[i + 1] = cursor;
        if (values[i] === null) nulls[i >> 3] |= 1 << (i & 7);
      }
      return { data, offsets, nulls, truncated: new Uint32Array(0) };
    }

    // Mirrors tests/ipc/support/types.ts's LogicalPage, redeclared rather than imported — this
    // function's body must be self-contained (see the doc comment above).
    type LocalLogicalPage =
      | {
          kind: 'tabular';
          columns: unknown[];
          rows: (string | null)[][];
          truncatedCells: number;
          position: unknown;
        }
      | { kind: 'document'; ids: (string | null)[]; bodies: (string | null)[]; position: unknown }
      | {
          kind: 'keyvalue';
          redisType: string;
          ttlMs: number | null;
          memoryBytes: number | null;
          fields: (string | null)[];
          values: (string | null)[];
          position: unknown;
        }
      | {
          kind: 'stream';
          keys: (string | null)[];
          headers: (string | null)[];
          attrs: (string | null)[];
          timestamps: (string | null)[];
          bodies: (string | null)[];
          visibilityTimeoutSeconds: number | null;
          position: unknown;
        };

    function buildPage(logical: LocalLogicalPage) {
      const base = { position: logical.position, byteSize: 0, fetchedAt: Date.now() };
      if (logical.kind === 'tabular') {
        const rowCount = logical.rows.length;
        return {
          ...base,
          kind: 'tabular',
          columns: logical.columns,
          rowCount,
          truncatedCells: logical.truncatedCells,
          chunks: logical.columns.map((_col: unknown, c: number) =>
            encodeChunk(logical.rows.map((r: (string | null)[]) => r[c])),
          ),
        };
      }
      if (logical.kind === 'document') {
        return {
          ...base,
          kind: 'document',
          rowCount: logical.ids.length,
          ids: encodeChunk(logical.ids),
          bodies: encodeChunk(logical.bodies),
        };
      }
      if (logical.kind === 'keyvalue') {
        return {
          ...base,
          kind: 'keyvalue',
          redisType: logical.redisType,
          ttlMs: logical.ttlMs,
          memoryBytes: logical.memoryBytes,
          rowCount: logical.fields.length,
          fields: encodeChunk(logical.fields),
          values: encodeChunk(logical.values),
        };
      }
      return {
        ...base,
        kind: 'stream',
        rowCount: logical.keys.length,
        visibilityTimeoutSeconds: logical.visibilityTimeoutSeconds,
        keys: encodeChunk(logical.keys),
        headers: encodeChunk(logical.headers),
        attrs: encodeChunk(logical.attrs),
        timestamps: encodeChunk(logical.timestamps),
        bodies: encodeChunk(logical.bodies),
      };
    }

    function buildResponsePayload(response: PortSnapshot['response']) {
      if (response.kind === 'read')
        return { page: buildPage(response.page), source: response.source };
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
      if (response.kind === 'execute') return { pages: response.pages.map(buildPage) };
      return {};
    }

    // opId/tabId are renderer-generated per request (random each run) and must not gate the
    // match; everything else in the payload (connectionId, path, filter, sort, cursor, pageSize)
    // is exactly what P50 D7 wants a spec able to assert on, so it is compared verbatim.
    function matchKey(op: string, payload: unknown): string {
      if (payload && typeof payload === 'object') {
        const { opId: _opId, tabId: _tabId, ...rest } = payload as Record<string, unknown>;
        return `${op}:${JSON.stringify(rest)}`;
      }
      return `${op}:${JSON.stringify(payload)}`;
    }

    const byKey = new Map<string, PortSnapshot>();
    for (const snap of snaps) byKey.set(matchKey(snap.op, snap.payload), snap);

    const seen: { op: string; payload: unknown }[] = [];
    const channel = new MessageChannel();
    channel.port2.onmessage = (event: MessageEvent) => {
      const req = event.data as { kind: 'req'; id: number; op: string; payload: unknown };
      seen.push({ op: req.op, payload: req.payload });
      const snap = byKey.get(matchKey(req.op, req.payload));
      if (!snap) {
        channel.port2.postMessage({
          kind: 'res',
          id: req.id,
          ok: false,
          error: { message: `no fixture snapshot for ${req.op}`, code: 'E_FIXTURE_MISS' },
        });
        return;
      }
      const reply = () =>
        channel.port2.postMessage({
          kind: 'res',
          id: req.id,
          ok: true,
          payload: buildResponsePayload(snap.response),
        });
      // Frontend-only (types.ts's PortSnapshot.delayMs): lets a spec observe a request as still
      // in flight — e.g. the stop button's enabled state — without a real slow query.
      if (snap.delayMs) setTimeout(reply, snap.delayMs);
      else reply();
    };
    channel.port2.start();
    (globalThis as unknown as { __kiraPortSeen: typeof seen }).__kiraPortSeen = seen;
    window.postMessage({ __kira: 'port' }, '*', [channel.port1]);
  }, snapshots as PortSnapshot[]);

  return {
    ops: () =>
      page.evaluate(
        () => (globalThis as unknown as { __kiraPortSeen: SeenPortRequest[] }).__kiraPortSeen,
      ),
  };
}
