import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COLUMN_WIDTHS,
  InMemoryViewStateStore,
  type PersistedViewState,
  parsePersistedViewState,
} from './viewState.ts';

/** A v7-shaped blob, matching `PersistedViewState`'s current fields exactly (adds
 *  `columnWidths.graph`, P92 item 1). */
function v7Blob(overrides: Partial<PersistedViewState> = {}): PersistedViewState {
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
    ...overrides,
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

describe('parsePersistedViewState — P92 item 1 version 6 -> 7', () => {
  test('a v7 blob with columnWidths.graph round-trips exactly', () => {
    const blob = v7Blob();
    expect(parsePersistedViewState(blob)).toEqual(blob);
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

  test('a v7 blob whose columnWidths carries a stray sha field is still accepted (extra fields are not checked)', () => {
    // isColumnWidthsShape only requires author/date/graph to be numbers — an extra field neither
    // breaks nor is specially handled, matching every other "shape" check in this file.
    const blob = v7Blob({ columnWidths: { author: 140, date: 152, graph: 95, sha: 80 } as never });
    expect(parsePersistedViewState(blob)).not.toBeNull();
  });

  test('missing columnWidths.graph (v6-style incompleteness in a v7-labelled blob) is rejected', () => {
    const blob = { ...v7Blob(), columnWidths: { author: 140, date: 152 } };
    expect(parsePersistedViewState(blob)).toBeNull();
  });

  test('InMemoryViewStateStore round-trips a real v7 write through read()', () => {
    const store = new InMemoryViewStateStore();
    const blob = v7Blob({ scrollRow: 7 });
    store.write(blob);
    expect(store.read()).toEqual(blob);
  });

  test('InMemoryViewStateStore.setRaw with a v6 blob reads back null, exactly like real platform storage would', () => {
    const store = new InMemoryViewStateStore();
    store.setRaw(v6Blob());
    expect(store.read()).toBeNull();
  });

  // G23 D12/F11: the four search toggles/scope round-trip like every other field — a v7 blob
  // with non-default values for all four survives read() back unchanged.
  test('a v7 blob with non-default search toggles/scope round-trips exactly', () => {
    const blob = v7Blob({
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
  test('a v7 blob with searchOpen: true round-trips exactly', () => {
    const blob = v7Blob({ searchOpen: true });
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });
});

describe('DEFAULT_COLUMN_WIDTHS — P92 item 1', () => {
  test('has a graph field, no sha field', () => {
    expect(Object.keys(DEFAULT_COLUMN_WIDTHS).sort()).toEqual(['author', 'date', 'graph']);
  });
});
