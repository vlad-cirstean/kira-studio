import { cellText, isNull, isTruncated, type StreamPage } from '@shared/protocol/page';
import { createPageStore } from '../shared/page/store';

const store = createPageStore<StreamPage>();

export const pageVersion = store.pageVersion;
export const setPage = store.setPage;
export const getPage = store.getPage;
export const drop = store.drop;
export const totalRetainedBytes = store.totalRetainedBytes;

export interface StreamRow {
  key: string | null;
  headers: string;
  attrs: string;
  timestamp: string | null;
  body: string;
  isTruncated: boolean;
}

export function streamRow(tabId: string, row: number): StreamRow | null {
  const page = getPage(tabId);
  if (!page || row < 0 || row >= page.rowCount) return null;

  // P2 R2 (task #99): see grid/page.ts's cell() for why this is wrapped in cachedView.
  return store.cachedView(tabId, row, 'row', () => {
    const cached = (subKey: string, chunk: Parameters<typeof cellText>[0]): string =>
      store.cached(tabId, row, subKey, (decoder) => cellText(chunk, row, decoder)) ?? '';

    return {
      key: isNull(page.keys, row) ? null : cached('key', page.keys),
      headers: cached('headers', page.headers),
      attrs: cached('attrs', page.attrs),
      timestamp: isNull(page.timestamps, row) ? null : cached('timestamp', page.timestamps),
      body: cached('body', page.bodies),
      isTruncated: isTruncated(page.bodies, row),
    };
  });
}
