import { cellByteLength, cellText, type DocumentPage, isTruncated } from '@shared/protocol/page';
import { resetRows, rowView } from '../shared/document/rows';
import { createPageStore } from '../shared/page/store';

// P27 D21: a new page has new rows — every memoized parse and every nested-expansion path
// views/shared/document/rows.ts holds for this tab is stale.
const store = createPageStore<DocumentPage>({ onSet: resetRows });

export const pageVersion = store.pageVersion;
export const setPage = store.setPage;
export const getPage = store.getPage;
export const drop = store.drop;
export const totalRetainedBytes = store.totalRetainedBytes;

export interface DocumentRow {
  id: string;
  body: string;
  isTruncated: boolean;
  bodyByteLength: number;
}

export function documentRow(tabId: string, row: number): DocumentRow | null {
  const page = getPage(tabId);
  if (!page || row < 0 || row >= page.rowCount) return null;
  // P2 R2 (task #99): see grid/page.ts's cell() for why this is wrapped in cachedView.
  return store.cachedView(tabId, row, 'row', () => ({
    id: store.cached(tabId, row, 'id', (decoder) => cellText(page.ids, row, decoder)) ?? '',
    body: store.cached(tabId, row, 'body', (decoder) => cellText(page.bodies, row, decoder)) ?? '',
    isTruncated: isTruncated(page.bodies, row),
    // Straight from the wire's own offsets — see cellByteLength's own doc comment for why this is
    // preferred over TextEncoder().encode(body).length (views/shared/document/rows.ts's byteLabel).
    bodyByteLength: cellByteLength(page.bodies, row),
  }));
}

// The projection picker's candidate list (ProjectionMenu.vue) and its toolbar badge
// (DocumentView.vue) both need "every top-level field name seen on the loaded page" — a document
// collection has no catalog to read a field list from (§0 note: "Documents' 'columns' are dynamic
// per-document fields"), so this is the closest equivalent, shared so the two call sites can't
// drift on how they parse a body into field names. `_id` is left out: it is always returned
// regardless of projection (mongo/read.ts's own comment) and already has its own column, so it is
// never a real projection choice. P27 D33: reuses documentRows.ts's memoized parse instead of its
// own `JSON.parse` per row — the tree renderer already walks every body on the page, so this stops
// being a second, divergent answer to "what are this document's top-level keys" (and a body that
// fails to parse, truncated or genuinely not an object, contributes no names either way — D22's
// `root === null` case).
export function fieldNamesOnPage(tabId: string): string[] {
  const page = getPage(tabId);
  if (!page) return [];
  const names = new Set<string>();
  for (let row = 0; row < page.rowCount; row++) {
    const view = rowView(tabId, row);
    if (!view?.root) continue;
    for (const child of view.root.children) {
      if (child.key !== '_id') names.add(child.key);
    }
  }
  return [...names].sort();
}
