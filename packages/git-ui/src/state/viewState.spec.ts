import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COLUMN_WIDTHS,
  InMemoryViewStateStore,
  type PersistedViewState,
  parsePersistedViewState,
} from './viewState.ts';

/** A v8-shaped blob, matching `PersistedViewState`'s current fields exactly (adds
 *  `collapseBranches`, P93 §4.4). */
function v8Blob(overrides: Partial<PersistedViewState> = {}): PersistedViewState {
  return {
    version: 8,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: DEFAULT_COLUMN_WIDTHS,
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
    searchOpen: false,
    collapseBranches: true,
    ...overrides,
  };
}

/** A v7 blob (P92 item 1's own shape, no `collapseBranches`) — what every profile that ever opened
 *  the graph panel before this phase still has in its own persisted storage. */
function v7Blob(): Record<string, unknown> {
  return {
    version: 7,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: DEFAULT_COLUMN_WIDTHS,
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
    searchOpen: false,
  };
}

/** A v6 blob (G-UX D9's own shape, no `columnWidths.graph`) — what every profile that ever opened
 *  the graph panel before this phase still has in its own persisted storage. */
function v6Blob(): Record<string, unknown> {
  return {
    version: 6,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: { author: 140, date: 152 },
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
    searchOpen: false,
  };
}

/** A v5 blob (G21 D5/D6a's own shape, no `searchOpen`) — what every profile that ever opened the
 *  graph panel before G-UX D9 still has in its own persisted storage. */
function v5Blob(): Record<string, unknown> {
  return {
    version: 5,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: { author: 140, date: 152 },
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
  };
}

/** A v4 blob (G19's own shape, `columnWidths.sha` present) — what every profile that ever opened
 *  the graph panel before G21 still has in its own persisted storage. */
function v4Blob(): Record<string, unknown> {
  return {
    version: 4,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: { author: 140, date: 120, sha: 80 }, // G19's own pre-fix default, still in it
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
  };
}

describe('parsePersistedViewState — P93 §4.4 version 7 -> 8', () => {
  test('a v8 blob with collapseBranches round-trips exactly', () => {
    const blob = v8Blob();
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });

  test('a v7 blob (no collapseBranches) is rejected whole, not partially applied', () => {
    // Same policy as every prior version bump: a v7 blob is what every profile that used the app
    // before this phase still has. It must be discarded entirely, so the panel re-seeds
    // collapseBranches from its own default (true) rather than crashing on a missing field.
    expect(parsePersistedViewState(v7Blob())).toBeNull();
  });

  test('a v6 blob (no columnWidths.graph) is rejected whole, not partially applied', () => {
    // Same policy as every prior version bump: a v6 blob is what every profile that used the app
    // before this phase still has. It must be discarded entirely, so the panel re-seeds
    // columnWidths.graph from DEFAULT_COLUMN_WIDTHS rather than crashing on a missing field.
    expect(parsePersistedViewState(v6Blob())).toBeNull();
  });

  test('a v5 blob (no searchOpen) is rejected whole, not partially applied', () => {
    expect(parsePersistedViewState(v5Blob())).toBeNull();
  });

  test('a v4 blob (with columnWidths.sha) is rejected whole, not partially applied', () => {
    expect(parsePersistedViewState(v4Blob())).toBeNull();
  });

  test('a v8 blob whose columnWidths carries a stray sha field is still accepted (extra fields are not checked)', () => {
    // isColumnWidthsShape only requires author/date/graph to be numbers — an extra field neither
    // breaks nor is specially handled, matching every other "shape" check in this file.
    const blob = v8Blob({ columnWidths: { author: 140, date: 152, graph: 95, sha: 80 } as never });
    expect(parsePersistedViewState(blob)).not.toBeNull();
  });

  test('missing columnWidths.graph (v6-style incompleteness in a v8-labelled blob) is rejected', () => {
    const blob = { ...v8Blob(), columnWidths: { author: 140, date: 152 } };
    expect(parsePersistedViewState(blob)).toBeNull();
  });

  test('InMemoryViewStateStore round-trips a real v8 write through read()', () => {
    const store = new InMemoryViewStateStore();
    const blob = v8Blob({ scrollRow: 7 });
    store.write(blob);
    expect(store.read()).toEqual(blob);
  });

  test('InMemoryViewStateStore.setRaw with a v6 blob reads back null, exactly like real platform storage would', () => {
    const store = new InMemoryViewStateStore();
    store.setRaw(v6Blob());
    expect(store.read()).toBeNull();
  });

  // G23 D12/F11: the four search toggles/scope round-trip like every other field — a v8 blob
  // with non-default values for all four survives read() back unchanged.
  test('a v8 blob with non-default search toggles/scope round-trips exactly', () => {
    const blob = v8Blob({
      searchCaseSensitive: true,
      searchWholeWord: true,
      searchRegex: true,
      searchScope: 'refs',
    });
    expect(parsePersistedViewState(blob)).toEqual(blob);
    const store = new InMemoryViewStateStore();
    store.write(blob);
    expect(store.read()).toEqual(blob);
  });

  // G-UX D9: searchOpen round-trips like every other boolean field.
  test('a v8 blob with searchOpen: true round-trips exactly', () => {
    const blob = v8Blob({ searchOpen: true });
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });

  // P93 §4.4: collapseBranches round-trips like every other boolean field.
  test('a v8 blob with collapseBranches: false round-trips exactly', () => {
    const blob = v8Blob({ collapseBranches: false });
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });
});

describe('DEFAULT_COLUMN_WIDTHS — P92 item 1', () => {
  test('has a graph field, no sha field', () => {
    expect(Object.keys(DEFAULT_COLUMN_WIDTHS).sort()).toEqual(['author', 'date', 'graph']);
  });
});
