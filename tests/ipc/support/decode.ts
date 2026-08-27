import { cellText, isNull, type Page } from '@shared/protocol/page';
import type { LogicalPage } from './types';

const decoder = new TextDecoder();

function decodeColumn(
  chunk: { data: Uint8Array; offsets: Uint32Array; nulls: Uint8Array; truncated: Uint32Array },
  rowCount: number,
): (string | null)[] {
  const out: (string | null)[] = new Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    out[row] = isNull(chunk, row) ? null : cellText(chunk, row, decoder);
  }
  return out;
}

/** The backend half's decoder: real wire page -> logical rows, via the production codec
 *  (`cellText`/`isNull`) — never a hand-rolled re-implementation (P50 D6). `fetchedAt`/`byteSize`
 *  are deliberately dropped; they are wall-clock/size-derived and would make every fixture a
 *  false failure on the next run. */
export function decodePage(page: Page): LogicalPage {
  if (page.kind === 'tabular') {
    const rows: (string | null)[][] = [];
    for (let row = 0; row < page.rowCount; row++) {
      rows.push(
        page.chunks.map((chunk) => (isNull(chunk, row) ? null : cellText(chunk, row, decoder))),
      );
    }
    return {
      kind: 'tabular',
      columns: page.columns,
      rows,
      position: page.position,
      truncatedCells: page.truncatedCells,
    };
  }
  if (page.kind === 'document') {
    return {
      kind: 'document',
      ids: decodeColumn(page.ids, page.rowCount),
      bodies: decodeColumn(page.bodies, page.rowCount),
      position: page.position,
    };
  }
  if (page.kind === 'keyvalue') {
    return {
      kind: 'keyvalue',
      redisType: page.redisType,
      ttlMs: page.ttlMs,
      memoryBytes: page.memoryBytes,
      fields: decodeColumn(page.fields, page.rowCount),
      values: decodeColumn(page.values, page.rowCount),
      position: page.position,
    };
  }
  return {
    kind: 'stream',
    keys: decodeColumn(page.keys, page.rowCount),
    headers: decodeColumn(page.headers, page.rowCount),
    attrs: decodeColumn(page.attrs, page.rowCount),
    timestamps: decodeColumn(page.timestamps, page.rowCount),
    bodies: decodeColumn(page.bodies, page.rowCount),
    position: page.position,
    visibilityTimeoutSeconds: page.visibilityTimeoutSeconds,
  };
}
