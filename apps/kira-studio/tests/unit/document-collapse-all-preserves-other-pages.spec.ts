// P21 round 3 functional finding 13: setAllExpanded's collapse branch replaced state.expanded
// wholesale with a fresh map containing only the ids it was handed (the currently rendered page),
// discarding every `false` entry for a document on any other page — an absent key means expanded,
// so paging away and back re-expanded everything collapsed there. state.expanded is persisted tab
// state, so this survived a restart as the wrong value too.
import './support/window';

import { describe, expect, test } from 'bun:test';

const { openDocumentTab } = await import('../../frontend/src/state/tabs');
const { isDocumentExpanded, setAllExpanded, toggleExpanded } = await import(
  '../../frontend/src/views/documents/state'
);

describe('setAllExpanded merges rather than replaces state.expanded (finding 13)', () => {
  test('collapsing page 2 does not re-expand documents collapsed on page 1', () => {
    const tabId = openDocumentTab('conn-doc', 'db/coll', { newTab: true }).id;

    setAllExpanded(tabId, ['p1-a', 'p1-b'], false); // collapse all on page 1
    expect(isDocumentExpanded(tabId, 'p1-a')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p1-b')).toBe(false);

    setAllExpanded(tabId, ['p2-a', 'p2-b'], false); // collapse all on page 2

    // Page 1's own collapsed documents must still be collapsed — the pre-fix bug replaced the
    // whole map with only page 2's ids, silently re-expanding page 1.
    expect(isDocumentExpanded(tabId, 'p1-a')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p1-b')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p2-a')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p2-b')).toBe(false);
  });

  test('a single per-document collapse on page 1 survives a "collapse all" on page 2', () => {
    const tabId = openDocumentTab('conn-doc', 'db/coll', { newTab: true }).id;

    toggleExpanded(tabId, 'p1-a'); // collapse just this one document, on page 1
    expect(isDocumentExpanded(tabId, 'p1-a')).toBe(false);

    setAllExpanded(tabId, ['p2-a', 'p2-b'], false); // collapse all on page 2

    expect(isDocumentExpanded(tabId, 'p1-a')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p2-a')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p2-b')).toBe(false);
  });

  test('"expand all" still clears the whole map — every page, not just the current one', () => {
    const tabId = openDocumentTab('conn-doc', 'db/coll', { newTab: true }).id;

    setAllExpanded(tabId, ['p1-a'], false);
    setAllExpanded(tabId, ['p2-a'], false);
    expect(isDocumentExpanded(tabId, 'p1-a')).toBe(false);
    expect(isDocumentExpanded(tabId, 'p2-a')).toBe(false);

    setAllExpanded(tabId, ['p2-a'], true); // "Expand all", called only with the current page's ids

    expect(isDocumentExpanded(tabId, 'p1-a')).toBe(true);
    expect(isDocumentExpanded(tabId, 'p2-a')).toBe(true);
  });
});
