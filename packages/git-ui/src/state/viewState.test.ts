import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COLUMN_WIDTHS,
  InMemoryViewStateStore,
  type PersistedViewState,
  parsePersistedViewState,
} from './viewState.ts';

/** A v6-shaped blob, matching `PersistedViewState`'s current fields exactly (adds `searchOpen`,
 *  G-UX D9). */
function v6Blob(overrides: Partial<PersistedViewState> = {}): PersistedViewState {
  return {
    version: 6,
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

/** A v5 blob (G21 D5/D6a's own shape, no `searchOpen`) — what every profile that ever opened the
 *  graph panel before this phase still has in its own persisted storage. */
function v5Blob(): Record<string, unknown> {
  return {
    version: 5,
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

describe('parsePersistedViewState — G-UX D9 version 5 -> 6', () => {
  test('a v6 blob with searchOpen round-trips exactly', () => {
    const blob = v6Blob();
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });

  test('a v5 blob (no searchOpen) is rejected whole, not partially applied', () => {
    // D9's own point: a v5 blob is what every profile that used the app before this phase still
    // has. It must be discarded entirely — parsePersistedViewState's own documented policy — so
    // the panel re-seeds searchOpen from its own default (closed) rather than crashing on a
    // missing field or silently treating `undefined` as falsy.
    expect(parsePersistedViewState(v5Blob())).toBeNull();
  });

  test('a v4 blob (with columnWidths.sha) is rejected whole, not partially applied', () => {
    expect(parsePersistedViewState(v4Blob())).toBeNull();
  });

  test('a v6 blob whose columnWidths carries a stray sha field is still accepted (extra fields are not checked)', () => {
    // isColumnWidthsShape only requires author/date to be numbers — an extra field neither
    // breaks nor is specially handled, matching every other "shape" check in this file.
    const blob = v6Blob({ columnWidths: { author: 140, date: 152, sha: 80 } as never });
    expect(parsePersistedViewState(blob)).not.toBeNull();
  });

  test('missing columnWidths.date (v4-style incompleteness in a v6-labelled blob) is rejected', () => {
    const blob = { ...v6Blob(), columnWidths: { author: 140 } };
    expect(parsePersistedViewState(blob)).toBeNull();
  });

  test('InMemoryViewStateStore round-trips a real v6 write through read()', () => {
    const store = new InMemoryViewStateStore();
    const blob = v6Blob({ scrollRow: 7 });
    store.write(blob);
    expect(store.read()).toEqual(blob);
  });

  test('InMemoryViewStateStore.setRaw with a v5 blob reads back null, exactly like real platform storage would', () => {
    const store = new InMemoryViewStateStore();
    store.setRaw(v5Blob());
    expect(store.read()).toBeNull();
  });

  // G23 D12/F11: the four search toggles/scope round-trip like every other field — a v6 blob
  // with non-default values for all four survives read() back unchanged.
  test('a v6 blob with non-default search toggles/scope round-trips exactly', () => {
    const blob = v6Blob({
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
  test('a v6 blob with searchOpen: true round-trips exactly', () => {
    const blob = v6Blob({ searchOpen: true });
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });
});

describe('DEFAULT_COLUMN_WIDTHS — G21 D5', () => {
  test('has no sha field — the SHA column is gone', () => {
    expect(Object.keys(DEFAULT_COLUMN_WIDTHS).sort()).toEqual(['author', 'date']);
  });
});
