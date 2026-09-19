import { repoIdOfWorkspace } from '@shared/domain/workspace';
import fuzzysort, { type KeysResult, type Result, type SnapshotKeys } from 'fuzzysort';
import { reactive, watch } from 'vue';
import { workspaceState } from '../../state/workspace';
import {
  ensureRepoTreeLoaded,
  isRepoTreeLoaded,
  repoTreePaths,
  repoTreeTruncated,
} from './fileTree';

// C9 §3.4: limit bounds sort work (fuzzysort's own `limit`), not just render work; candidates
// bounds the per-keystroke matching cost itself (D3's measured knee — 34.78ms worst query at 50k,
// 144.06ms at 200k); threshold is fuzzysort's own documented "good match" floor.
export const QUICK_OPEN_MAX_RESULTS = 50;
export const QUICK_OPEN_MAX_CANDIDATES = 50_000;
const QUICK_OPEN_THRESHOLD = 0.4;

// §3.2 rule 2: small against fuzzysort's 0..1 scale, so it only ever breaks a near-tie, never
// promotes a worse match.
const DEPTH_PENALTY = 0.001;

// §3.1: repository-relative path, git's own bytes verbatim — no NFC normalisation (enumerate.go's
// tier-2 rule; openRepoFileTab hands this straight to ReadFile).
interface QuickOpenItem {
  path: string;
  name: string; // basename
  dir: string; // parent dir, '' at root
  depth: number; // count of '/' in path
}

function buildItems(paths: readonly string[]): QuickOpenItem[] {
  return paths.map((path) => {
    const slash = path.lastIndexOf('/');
    const name = slash === -1 ? path : path.slice(slash + 1);
    const dir = slash === -1 ? '' : path.slice(0, slash);
    let depth = 0;
    for (let i = 0; i < dir.length; i++) if (dir.charCodeAt(i) === 47) depth++;
    return { path, name, dir, depth };
  });
}

interface HighlightPart {
  text: string;
  matched: boolean;
}

// fuzzysort's own `.score`: "1 is exact, 0.5 is good, and 0 is no match" — 0 is the documented
// no-match sentinel (a key that never matched is materialised as a real Result over '', scored 0),
// so only a genuine match is worth highlighting.
function highlightParts(result: Result | undefined, fallback: string): HighlightPart[] {
  if (!result || result.score <= 0) return [{ text: fallback, matched: false }];
  return result
    .highlight<HighlightPart>((match) => ({ text: match, matched: true }))
    .map((part) => (typeof part === 'string' ? { text: part, matched: false } : part));
}

interface QuickOpenCache {
  paths: readonly string[]; // D9: reference identity is the invalidation signal
  items: QuickOpenItem[];
  snapshot: SnapshotKeys<QuickOpenItem>;
}

// D9: one snapshot per repo, rebuilt only when refreshRepoTree assigns a fresh `paths` array.
const snapshotCache = new Map<string, QuickOpenCache>();

function ensureSnapshot(repoId: string): QuickOpenCache {
  const paths = repoTreePaths(repoId);
  const cached = snapshotCache.get(repoId);
  if (cached && cached.paths === paths) return cached;
  // C13-7: candidatesTruncated used to also be stored on this cache entry for
  // quickOpenTruncated() to read back -- but this cache is a plain (non-reactive) Map, so that read
  // registered no Vue dependency, and the `truncated` computed (QuickOpen.vue) silently froze at
  // whatever it evaluated to the first time the palette opened. quickOpenTruncated below now
  // derives the same condition straight from the tracked reactive `paths` array instead, so this
  // is purely a local slicing bound again, not state anything reads back reactively.
  const candidatesTruncated = paths.length > QUICK_OPEN_MAX_CANDIDATES;
  const items = buildItems(candidatesTruncated ? paths.slice(0, QUICK_OPEN_MAX_CANDIDATES) : paths);
  const snapshot = fuzzysort.snapshot(items, { keys: ['name', 'path'] });
  const fresh: QuickOpenCache = { paths, items, snapshot };
  snapshotCache.set(repoId, fresh);
  return fresh;
}

export interface QuickOpenRow {
  path: string;
  dir: string;
  nameParts: HighlightPart[];
}

function toRow(item: QuickOpenItem, nameResult: Result | undefined): QuickOpenRow {
  return { path: item.path, dir: item.dir, nameParts: highlightParts(nameResult, item.name) };
}

export const quickOpenState = reactive({ open: false, repoId: '', query: '' });

// D6: gated on the active workspace, not on a mounted component — reachable with the project panel
// collapsed. D8: loads the tree itself, since byRepo may have no entry yet.
export function openQuickOpen(): void {
  const repoId = repoIdOfWorkspace(workspaceState.active);
  if (repoId === null) return;
  quickOpenState.repoId = repoId;
  quickOpenState.query = '';
  quickOpenState.open = true;
  ensureRepoTreeLoaded(repoId);
}

// C14-8: the fuzzysort snapshot is a large per-repo allocation (~110-150MB measured on a big repo)
// that used to live for the whole workspace's lifetime once the palette had been opened once, even
// after closing it -- three large open repos could hold ~350MB idle for a feature used in bursts.
// Evicting on close trades that for one rebuild the next time the palette opens (15-26ms measured,
// negligible against the memory freed) -- ensureSnapshot already rebuilds transparently on demand,
// keyed off `paths`' own reference identity, so this needs no other change.
export function closeQuickOpen(): void {
  const repoId = quickOpenState.repoId;
  quickOpenState.open = false;
  if (repoId) snapshotCache.delete(repoId);
}

/** True while `openQuickOpen`'s own tree load for the open repo hasn't resolved yet. */
export function quickOpenLoading(): boolean {
  return quickOpenState.open && !isRepoTreeLoaded(quickOpenState.repoId);
}

// C13-7: was `quickOpenTruncated`, reading `snapshotCache.get(repoId)?.candidatesTruncated` for
// its own half of this condition -- but snapshotCache is a plain (non-reactive) Map, so that read
// registered no Vue dependency at all. The wrapping `computed` (QuickOpen.vue's own `truncated`)
// then cached whatever this returned the first time the palette opened for good: `quickOpenState.
// repoId` and `repoTreeTruncated`'s own reactive Map read were its only two real dependencies, and
// neither changes when a later tree refresh's `paths` array crosses QUICK_OPEN_MAX_CANDIDATES.
// Fixed by deriving the candidate-cap half the same way repoTreePaths already does for everything
// else -- reading the tracked reactive `paths` array directly needs no cache lookup at all.
//
// Renamed (not just fixed in place) because this is a query-INDEPENDENT condition -- "the
// candidate set quick open searches is incomplete" -- distinct from the query-dependent "this
// query's own results hit the QUICK_OPEN_MAX_RESULTS display cap" (checked by the caller against
// its own `rows.length`, quickOpenResults's own return). The old single `quickOpenTruncated` name
// and the UI's single notice conflated the two: a query with 3 real matches in a huge repo used to
// still claim "first 50 of many matches" merely because the candidate set was capped.
export function quickOpenIndexTruncated(): boolean {
  const repoId = quickOpenState.repoId;
  if (!repoId) return false;
  if (repoTreeTruncated(repoId)) return true;
  return repoTreePaths(repoId).length > QUICK_OPEN_MAX_CANDIDATES;
}

export function quickOpenResults(): QuickOpenRow[] {
  const { repoId, query } = quickOpenState;
  if (!repoId || !isRepoTreeLoaded(repoId)) return [];
  const cache = ensureSnapshot(repoId);
  const q = query.trim();
  // §3.3: empty query shows the first MAX_RESULTS items, unmatched — the "open it, see something"
  // affordance, costing no fuzzysort call.
  if (q === '') {
    return cache.items.slice(0, QUICK_OPEN_MAX_RESULTS).map((item) => toRow(item, undefined));
  }
  const results = fuzzysort.go(q, cache.snapshot, {
    limit: QUICK_OPEN_MAX_RESULTS,
    threshold: QUICK_OPEN_THRESHOLD,
    // §3.2: basename beats path (0.8-discounted path score so a path-only match still surfaces),
    // shallower breaks a near-tie. No recency term yet — deliberately out of scope (§9).
    scoreFn: (r: KeysResult<QuickOpenItem>) => {
      const name = r[0] ? r[0].score : 0;
      const path = r[1] ? r[1].score * 0.8 : 0;
      return Math.max(name, path) - r.obj.depth * DEPTH_PENALTY;
    },
  });
  return results.map((r) => toRow(r.obj, r[0]));
}

// C9 D9 cache eviction — a removed or closed repo's snapshot must not outlive it in this
// module-level cache. Called both by the `openRepos` watch below (C13-3: every closeRepoWorkspace,
// removeCodeRepo included, since it calls closeRepoWorkspace itself) and directly wherever a caller
// wants the eviction to happen synchronously rather than on the watcher's next flush. Also closes
// the palette if it happened to be showing repoId (the ordinary case is already covered by the
// workspaceState.active watch below, since closeRepoWorkspace always clears `active` first when the
// closed workspace was the active one).
function dropQuickOpen(repoId: string): void {
  snapshotCache.delete(repoId);
  if (quickOpenState.open && quickOpenState.repoId === repoId) closeQuickOpen();
}

// Closing the workspace (TitleBar's own close button, or removeCodeRepo's closeRepoWorkspace call)
// must close the palette if it's showing that repo. Watched here rather than called from
// state/workspace.ts's closeRepoWorkspace, to keep the import direction one-way (this module
// imports state/workspace.ts, never the reverse, per §5's own check).
watch(
  () => workspaceState.active,
  (active) => {
    if (quickOpenState.open && repoIdOfWorkspace(active) !== quickOpenState.repoId)
      closeQuickOpen();
  },
);

// C13-3: closeRepoWorkspace (state/workspace.ts) drops this repo's own tree/search caches directly,
// but can't call dropQuickOpen the same way without violating the one-way import direction above —
// so it's watched here instead. workspaceState.openRepos is always reassigned wholesale (never
// mutated in place, both call sites), so a plain (non-deep) watch sees the pre-close membership as
// `previous` and evicts whichever repoId(s) just dropped out.
watch(
  () => workspaceState.openRepos,
  (openRepos, previous) => {
    if (!previous) return;
    for (const repoId of previous) {
      if (!openRepos.includes(repoId)) dropQuickOpen(repoId);
    }
  },
);
