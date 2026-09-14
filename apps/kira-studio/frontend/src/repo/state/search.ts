import type { CodeSearchEvent, FileMatches, SearchStats } from '@shared/domain/repo';
import { markRaw, reactive } from 'vue';
import { control } from '../../bridge/control';

// C7 §7.2: the repository-wide search store — one entry per open repo workspace, the panel's
// Files/Search switch (D9), the query/options, and the streamed result list. A search runs on
// Enter or the Search button only (D10) — never on every keystroke, since each run reads every
// non-skipped file in the worktree.

export interface RepoSearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

function defaultOptions(): RepoSearchOptions {
  return { regex: false, caseSensitive: false, wholeWord: false };
}

interface RepoSearchState {
  view: 'files' | 'search' | 'review';
  query: string;
  options: RepoSearchOptions;
  searchId: string | null; // null when idle
  running: boolean;
  files: FileMatches[]; // path-sorted (D11)
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
    files: [],
    collapsed: new Set(),
    stats: null,
    error: null,
  };
}

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

export function repoSearchView(repoId: string): 'files' | 'search' | 'review' {
  return byRepo.get(repoId)?.view ?? 'files';
}

export function setRepoSearchView(repoId: string, view: 'files' | 'search' | 'review'): void {
  stateFor(repoId).view = view;
}

export function repoSearchQuery(repoId: string): string {
  return byRepo.get(repoId)?.query ?? '';
}

export function setRepoSearchQuery(repoId: string, query: string): void {
  stateFor(repoId).query = query;
}

export function repoSearchOptions(repoId: string): RepoSearchOptions {
  return byRepo.get(repoId)?.options ?? defaultOptions();
}

export function toggleRepoSearchOption(repoId: string, key: keyof RepoSearchOptions): void {
  const state = stateFor(repoId);
  state.options[key] = !state.options[key];
}

export function repoSearchRunning(repoId: string): boolean {
  return byRepo.get(repoId)?.running ?? false;
}

export function repoSearchStats(repoId: string): SearchStats | null {
  return byRepo.get(repoId)?.stats ?? null;
}

export function repoSearchError(repoId: string): string | null {
  return byRepo.get(repoId)?.error ?? null;
}

// searchId -> repoId: an incoming event is routed by searchId only (§4.3), so this is how it finds
// its own state entry without scanning every open repo's own state.
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
  // touches `state.files` -- once inserted, a group is only ever replaced wholesale (insertByPath's
  // own splice, on a same-path recur), never field-mutated, so there is nothing for Vue's deep
  // reactivity to usefully track inside it. Without this, `state.files` (living inside this repo's
  // `reactive()` state object) deep-proxies every FileMatches/SearchMatch arriving off the wire.
  // Measured 45x: 73ms plain vs 3,275ms reactive over 243,192 cumulative rows across one capped
  // 10,000-match search's ~38 flush batches. The containing array itself stays a normal reactive
  // property, so splice/length changes still notify repoSearchRows' own callers correctly.
  for (const group of event.files) insertByPath(state.files, markRaw(group));

  if (event.done) {
    state.running = false;
    state.stats = event.stats ?? null;
    state.error = event.error?.message ?? null;
    repoBySearchId.delete(event.searchId);
  }
}

// D11: workers emit out of order; git ls-files' own output is already sorted, so inserting each
// incoming group at its sorted position gives a stable, alphabetical list that never reshuffles.
// Replaces an existing group for the same path rather than duplicating it — defensive: today's
// Search never reports the same path twice in one run, but the merge stays correct either way.
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

/** Runs repoId's own current query/options — a no-op for a blank query. A rejected call (bad
 *  regex, git unavailable) sets `error` and leaves `running` false, the same "surface it, don't
 *  throw into the caller" shape refreshRepoTree already uses. */
export async function startRepoSearch(repoId: string): Promise<void> {
  const state = stateFor(repoId);
  if (state.query.trim() === '') return;
  ensureSubscribed();

  if (state.searchId) repoBySearchId.delete(state.searchId); // supersede (D8) our own previous run.
  state.files = [];
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

/** Stops repoId's own in-flight search, if any — the panel's own Stop button. Fire-and-forget: the
 *  terminal event this run still owes (D7/D8) is what actually clears `running`. */
export function cancelRepoSearch(repoId: string): void {
  void control.codeWorkspaceCancelSearch(repoId);
}

export function toggleRepoSearchCollapse(repoId: string, path: string): void {
  const state = stateFor(repoId);
  if (state.collapsed.has(path)) state.collapsed.delete(path);
  else state.collapsed.add(path);
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

export function repoSearchRows(repoId: string): RepoSearchRowVm[] {
  const state = byRepo.get(repoId);
  if (!state) return [];
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
export function dropRepoSearch(repoId: string): void {
  const state = byRepo.get(repoId);
  if (state?.searchId) repoBySearchId.delete(state.searchId);
  byRepo.delete(repoId);
}
