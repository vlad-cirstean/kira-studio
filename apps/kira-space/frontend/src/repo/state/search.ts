import type { CodeSearchEvent, FileMatches, SearchStats } from '@shared/domain/repo';
import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
import { control } from '../../bridge/control';

// C7 §7.2: the repository-wide search store — one entry per open repo workspace, the panel's
// Files/Search switch (D9), the query/options, and the streamed result list. A search runs on
// Enter or the Search button only (D10) — never on every keystroke, since each run reads every
// non-skipped file in the worktree.
//
// P99 §5.2: split from the flat "which of GitPanel's three top-level tabs is showing" concern,
// which is not a search concept at all — that lives in useRepoPanelTabStore below, one store one
// concern.

export interface RepoSearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

function defaultOptions(): RepoSearchOptions {
  return { regex: false, caseSensitive: false, wholeWord: false };
}

interface RepoSearchState {
  view: 'files' | 'search';
  query: string;
  options: RepoSearchOptions;
  searchId: string | null; // null when idle
  running: boolean;
  // C14-1: path-sorted (D11), markRaw'd -- see insertByPath's own comment. Never read this
  // directly outside insertByPath/repoSearchRows; go through `filesVersion` for reactivity.
  files: FileMatches[];
  // Bumped once per incoming batch that mutates `files` in place. `files` itself is markRaw'd (so
  // splicing it never walks a reactive proxy -- see insertByPath), which means Vue can no longer
  // see those mutations; this counter is the reactive signal repoSearchRows depends on instead.
  filesVersion: number;
  collapsed: Set<string>;
  stats: SearchStats | null;
  error: string | null;
}

function emptySearchState(): RepoSearchState {
  return {
    view: 'files',
    query: '',
    options: defaultOptions(),
    searchId: null,
    running: false,
    files: markRaw([]),
    filesVersion: 0,
    collapsed: new Set(),
    stats: null,
    error: null,
  };
}

// D11: workers emit out of order; git ls-files' own output is already sorted, so inserting each
// incoming group at its sorted position gives a stable, alphabetical list that never reshuffles.
// Replaces an existing group for the same path rather than duplicating it — defensive: today's
// Search never reports the same path twice in one run, but the merge stays correct either way.
// Pure function over its arguments alone — no reactive state, stays outside the store.
function insertByPath(files: FileMatches[], group: FileMatches): void {
  let lo = 0;
  let hi = files.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (files[mid].path < group.path) lo = mid + 1;
    else hi = mid;
  }
  if (files[lo]?.path === group.path) files.splice(lo, 1, group);
  else files.splice(lo, 0, group);
}

// The flat row fold for VirtualList (§7.2): one header row per file followed by its own match rows
// unless collapsed — uniform row height, so a 10,000-match run still renders a screenful.
export interface RepoSearchRowVm {
  key: string;
  kind: 'file' | 'match';
  path: string;
  // 'file' rows only:
  matchCount?: number;
  collapsed?: boolean;
  fileTruncated?: boolean;
  // 'match' rows only:
  line?: number;
  column?: number;
  endColumn?: number;
  preview?: string;
  previewMatchStart?: number;
  previewMatchEnd?: number;
}

export const useRepoSearchStore = defineStore('repoSearch', () => {
  // One entry per open repo workspace — reactive Map for the identical reason state/fileTree.ts's
  // own byRepo is: an untracked `.get()` on a plain Map never re-renders a computed that reads it
  // before the entry exists (repoSearchView's own first read, evaluated before startRepoSearch has
  // ever created one).
  const byRepo = reactive(new Map<string, RepoSearchState>());

  function stateFor(repoId: string): RepoSearchState {
    let state = byRepo.get(repoId);
    if (!state) {
      state = reactive(emptySearchState()) as RepoSearchState;
      byRepo.set(repoId, state);
    }
    return state;
  }

  function repoSearchView(repoId: string): 'files' | 'search' {
    return byRepo.get(repoId)?.view ?? 'files';
  }

  function setRepoSearchView(repoId: string, view: 'files' | 'search'): void {
    stateFor(repoId).view = view;
  }

  function repoSearchQuery(repoId: string): string {
    return byRepo.get(repoId)?.query ?? '';
  }

  function setRepoSearchQuery(repoId: string, query: string): void {
    stateFor(repoId).query = query;
  }

  function repoSearchOptions(repoId: string): RepoSearchOptions {
    return byRepo.get(repoId)?.options ?? defaultOptions();
  }

  function toggleRepoSearchOption(repoId: string, key: keyof RepoSearchOptions): void {
    const state = stateFor(repoId);
    state.options[key] = !state.options[key];
  }

  function repoSearchRunning(repoId: string): boolean {
    return byRepo.get(repoId)?.running ?? false;
  }

  function repoSearchStats(repoId: string): SearchStats | null {
    return byRepo.get(repoId)?.stats ?? null;
  }

  function repoSearchError(repoId: string): string | null {
    return byRepo.get(repoId)?.error ?? null;
  }

  // searchId -> repoId: an incoming event is routed by searchId only (§4.3), so this is how it
  // finds its own state entry without scanning every open repo's own state.
  const repoBySearchId = new Map<string, string>();

  // Created once, lazily, on the first search (D7's own note: a window that never opens a repo
  // workspace should not hold a listener) — never at module load or app boot.
  let unsubscribe: (() => void) | null = null;

  function ensureSubscribed(): void {
    if (unsubscribe) return;
    unsubscribe = control.onCodeSearch(handleCodeSearchEvent);
  }

  function handleCodeSearchEvent(event: CodeSearchEvent): void {
    const repoId = repoBySearchId.get(event.searchId);
    if (!repoId) return; // A superseded (D8) or already-finished search's late batch is dropped.
    const state = byRepo.get(repoId);
    if (!state || state.searchId !== event.searchId) return;

    // C13-5: each incoming group (and its own nested matches array) is markRaw'd before it ever
    // touches `state.files` -- once inserted, a group is only ever replaced wholesale
    // (insertByPath's own splice, on a same-path recur), never field-mutated, so there is nothing
    // for Vue's deep reactivity to usefully track inside it.
    //
    // C14-1: `state.files` itself is now ALSO markRaw'd (see emptySearchState/startRepoSearch), so
    // insertByPath's splice runs against a plain array, never a reactive proxy -- C13-5 alone
    // still left every element-shift from a mid-array splice walking Vue's get/set traps, O(F)
    // per insert and O(F^2) over a streaming search. Measured on a capped 10,000-match search:
    // 41,550ms cumulative main-thread cost (one flush as high as 2,100ms) through the reactive
    // array, vs 2ms for the identical splice sequence on a plain one. Since a raw array's
    // in-place mutation notifies no one, `filesVersion` below is what tells repoSearchRows' own
    // computed new rows are ready.
    for (const group of event.files) insertByPath(state.files, markRaw(group));
    if (event.files.length > 0) state.filesVersion++;

    if (event.done) {
      state.running = false;
      state.stats = event.stats ?? null;
      state.error = event.error?.message ?? null;
      repoBySearchId.delete(event.searchId);
    }
  }

  /** Runs repoId's own current query/options — a no-op for a blank query. A rejected call (bad
   *  regex, git unavailable) sets `error` and leaves `running` false, the same "surface it, don't
   *  throw into the caller" shape refreshRepoTree already uses. */
  async function startRepoSearch(repoId: string): Promise<void> {
    const state = stateFor(repoId);
    if (state.query.trim() === '') return;
    ensureSubscribed();

    if (state.searchId) repoBySearchId.delete(state.searchId); // supersede (D8) our own previous run.
    state.files = markRaw([]);
    state.filesVersion++;
    state.collapsed = new Set();
    state.stats = null;
    state.error = null;
    state.running = true;
    state.searchId = null;

    try {
      const { searchId } = await control.codeWorkspaceStartSearch(repoId, {
        query: state.query,
        regex: state.options.regex,
        caseSensitive: state.options.caseSensitive,
        wholeWord: state.options.wholeWord,
      });
      state.searchId = searchId;
      repoBySearchId.set(searchId, repoId);
    } catch (err) {
      state.running = false;
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Stops repoId's own in-flight search, if any — the panel's own Stop button. Fire-and-forget:
   *  the terminal event this run still owes (D7/D8) is what actually clears `running`. */
  function cancelRepoSearch(repoId: string): void {
    void control.codeWorkspaceCancelSearch(repoId);
  }

  function toggleRepoSearchCollapse(repoId: string, path: string): void {
    const state = stateFor(repoId);
    if (state.collapsed.has(path)) state.collapsed.delete(path);
    else state.collapsed.add(path);
  }

  function repoSearchRows(repoId: string): RepoSearchRowVm[] {
    const state = byRepo.get(repoId);
    if (!state) return [];
    // `state.files` is markRaw'd (C14-1): reading it does not by itself see in-place
    // splice/insert mutations, only reference replacement. `filesVersion` is the reactive
    // dependency this computed actually needs to re-run as new groups stream in -- read it
    // before touching `files`.
    void state.filesVersion;
    const rows: RepoSearchRowVm[] = [];
    for (const group of state.files) {
      const collapsed = state.collapsed.has(group.path);
      rows.push({
        key: `file:${group.path}`,
        kind: 'file',
        path: group.path,
        matchCount: group.matches.length,
        collapsed,
        fileTruncated: group.truncated,
      });
      if (collapsed) continue;
      group.matches.forEach((m, i) => {
        rows.push({
          key: `match:${group.path}:${i}`,
          kind: 'match',
          path: group.path,
          line: m.line,
          column: m.column,
          endColumn: m.endColumn,
          preview: m.preview,
          previewMatchStart: m.previewMatchStart,
          previewMatchEnd: m.previewMatchEnd,
        });
      });
    }
    return rows;
  }

  /** Drops repoId's own cached search state — RemoveRepo's own cleanup, mirroring dropRepoTree. */
  function dropRepoSearch(repoId: string): void {
    const state = byRepo.get(repoId);
    if (state?.searchId) repoBySearchId.delete(state.searchId);
    byRepo.delete(repoId);
  }

  return {
    repoSearchView,
    setRepoSearchView,
    repoSearchQuery,
    setRepoSearchQuery,
    repoSearchOptions,
    toggleRepoSearchOption,
    repoSearchRunning,
    repoSearchStats,
    repoSearchError,
    startRepoSearch,
    cancelRepoSearch,
    toggleRepoSearchCollapse,
    repoSearchRows,
    dropRepoSearch,
  };
});

// P92 item 6: which of GitPanel.vue's three top-level tabs is showing. Flat, not per-repo keyed
// like useRepoSearchStore's own `view` — GitPanel.vue is one persistent instance across every
// repo workspace (C11 §8.4's own note), so this is genuinely one value, not one per repoId. Its
// own store, not folded into useRepoSearchStore above, so hostHandlers.ts's review.open (the one
// external caller — "review" used to be a value of `view`, which repo/state/search.ts already let
// it set) can flip the visible tab without depending on the whole search store.
export const useRepoPanelTabStore = defineStore('repoPanelTab', () => {
  const panelTab = ref<'repos' | 'files' | 'review'>('repos');

  function repoPanelTab(): 'repos' | 'files' | 'review' {
    return panelTab.value;
  }

  function setRepoPanelTab(tab: 'repos' | 'files' | 'review'): void {
    panelTab.value = tab;
  }

  return { repoPanelTab, setRepoPanelTab };
});
