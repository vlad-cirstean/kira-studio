import type { GhStatus, PrLookupResult, PrRecord } from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

/** D7's own selection debounce — arrow-keying through forty rows in one second costs one call,
 *  not forty. */
const SELECTION_DEBOUNCE_MS = 300;

/** G30 round-1 performance review, finding #1: `ensureSnapshot`'s own worker-pool cap — see that
 *  method's doc comment. Six, not one and not unbounded: small enough that a repo with hundreds of
 *  branches never opens more than a handful of requests at once, large enough that warming a
 *  normal-sized branch list still finishes in one or two batches rather than trickling one at a
 *  time. */
const PR_ENSURE_SNAPSHOT_CONCURRENCY = 6;

/**
 * G24 D10: the one client-side owner of every GitHub PR fact this app renders — the graph
 * indicator's per-commit lookup, the branch-tip badges/search's per-branch lookup, and the single
 * `GhStatus` the commit-detail pane's failure line (D12) reads. Mirrors `DetailState.select`'s own
 * abort-and-recheck discipline for the per-commit half; the per-branch half is plain
 * request-then-cache, since a branch's own PR record has no "supersede on reselect" race the way a
 * rapidly-changing commit selection does.
 *
 * **Deviation from D10's literal signature, documented here:** `ensureSnapshot` takes the branch
 * names to warm (`readonly string[]`) rather than no arguments at all. D10 lists it as
 * `ensureSnapshot(): Promise<void>`, but this class holds no `RefsState` reference of its own (D10
 * threads only `bridge` into its constructor, exactly like `DetailState`) and so has no other way
 * to know which branches exist to warm. The server-side half of D6's own "one bulk read" snapshot
 * is unaffected: `branch.resolvePr` answers every one of these calls from `RepoEntry`'s own cached
 * open-PR snapshot with zero additional GitHub calls, so calling this once per known branch still
 * costs the server nothing beyond its own already-lazy, already-cached snapshot fetch — only the
 * signature (not the network/caching shape D6 describes) differs from the plan's own literal
 * wording.
 */
export class PrState {
  /** Per-commit PR records, populated only on a resolved `"ok"` answer — `columns.ts`'s own
   *  `PrContext` reads this by sha. A sha simply absent from this map means "render nothing"
   *  (not-yet-resolved, in-flight, `disabled`, or `unavailable` all collapse to the same "nothing
   *  in the grid" outcome, D9's own "inert, never noisy" rule) — the grid never needs to
   *  distinguish those four itself. */
  readonly bySha: ShallowRef<ReadonlyMap<string, readonly PrRecord[]>> = shallowRef(new Map());
  /** Per-branch PR record — `BranchPicker.vue`'s own `#123` badge and `matchRef`'s own `pr` arm
   *  (via `state/search.ts`) both read this by branch short name. Absent means "no known PR (yet,
   *  or at all)" — same "render nothing" rule as `bySha`. */
  readonly byBranch: ShallowRef<ReadonlyMap<string, PrRecord>> = shallowRef(new Map());
  /** Bumped on every change to `bySha`/`byBranch` — `CommitGrid.vue`'s own `pr.generation`
   *  watcher (a third instance of the `graphView.generation`/`search.searchGeneration` pattern)
   *  re-renders the message column on this alone. */
  readonly generation: ShallowRef<number> = shallowRef(0);
  /** The most recent non-`"ok"` `GhStatus` this instance has seen, from either lookup — D12's own
   *  "one line of `Status.Reason`" in the commit-detail pane reads this. Never used to decide
   *  what the grid renders (the grid only ever consults `bySha`/`byBranch`). */
  readonly status: ShallowRef<GhStatus | undefined> = shallowRef(undefined);
  /** The raw result of the most recently SETTLED `commit.resolvePr` for whichever sha is
   *  currently selected — `CommitMeta.vue`'s own "Pull request" row (D12) needs the full
   *  discriminated union (`disabled` ⇒ row absent; `unavailable` ⇒ `gh.reason`; `ok` with an empty
   *  list ⇒ "No pull request"; `ok` with entries ⇒ one row each), which `bySha`'s collapsed shape
   *  cannot answer on its own. `undefined` while nothing is selected or a request is still
   *  in-flight/debounced. */
  readonly selected: ShallowRef<PrLookupResult | undefined> = shallowRef(undefined);

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  #sha: string | null = null;
  #selectTimer: ReturnType<typeof setTimeout> | undefined;
  #selectController: AbortController | undefined;
  readonly #branchRequests = new Set<string>();
  /** G31 round-2 performance review, finding #3: branches whose `branch.resolvePr` answer came
   *  back `"ok"` with no PR at all. `byBranch` only ever holds an actual `PrRecord`, so a
   *  no-PR branch never appeared in it — `ensureSnapshot`'s own dedup filter (`!byBranch.has(name)
   *  && !#branchRequests.has(name)`) then failed both checks forever, and every `BranchPicker.vue`
   *  open / search-scope change / stack reload re-issued `branch.resolvePr` for every PR-less
   *  branch, indefinitely. Tracked separately (rather than widening `byBranch`'s value type) so
   *  every existing `byBranch.value.get(name)` call site keeps meaning "the branch's PR, if any"
   *  with no signature change. */
  readonly #noBranchPr = new Set<string>();
  /** Set the first time EITHER lookup answers `"disabled"` for the current repo (github.enabled
   *  off, or no GitHub remote) — every later selection/branch resolve for this same repo then
   *  answers `"disabled"` synchronously, with no request at all, until the repo changes or
   *  refsChanged clears it (a remote could have been added since). Not required for correctness
   *  (a disabled repo already costs the server nothing beyond a settings/remote-cache read), but
   *  it means arrow-keying through a whole disabled repository's history issues zero requests
   *  rather than one debounced no-op per row. */
  #disabledForRepo = false;
  readonly #unsubscribe: () => void;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    // Mirrors RefsState's own three lines (D10): subscribes to repo.changed's refsChanged kind
    // and clears everything — the server already dropped its own caches for the same signal (D6),
    // so there is nothing worth eagerly re-fetching here; the next selection/badge render
    // re-requests lazily, exactly as a first-ever selection would.
    this.#unsubscribe = bridge.on('repo.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      if (event.kind !== 'refsChanged') return;
      this.#clear();
    });
  }

  /** Called whenever the active repo changes — mirrors `RefsState`/`DetailState`'s own
   *  `setRepoId`: clears every cache (a different repository's PR facts are simply not this
   *  repository's), and cancels any in-flight/debounced per-commit request. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
    this.#clear();
  }

  #clear(): void {
    this.#selectController?.abort();
    if (this.#selectTimer !== undefined) {
      clearTimeout(this.#selectTimer);
      this.#selectTimer = undefined;
    }
    this.#sha = null;
    this.#branchRequests.clear();
    this.#noBranchPr.clear();
    this.#disabledForRepo = false;
    this.bySha.value = new Map();
    this.byBranch.value = new Map();
    this.selected.value = undefined;
    this.status.value = undefined;
    this.generation.value++;
  }

  /** Selection changed (`SelectionState`'s own sha, mirrored here by the caller, exactly as
   *  `DetailState.select` already is) — starts D7's own 300ms debounce, aborting any in-flight
   *  request first. `null` clears the current selection's own result immediately, with no
   *  request. */
  select(sha: string | null): void {
    this.#selectController?.abort();
    if (this.#selectTimer !== undefined) {
      clearTimeout(this.#selectTimer);
      this.#selectTimer = undefined;
    }
    this.#sha = sha;
    if (sha === null) {
      this.selected.value = undefined;
      return;
    }
    if (this.#disabledForRepo) {
      this.selected.value = { kind: 'disabled' };
      return;
    }
    this.selected.value = undefined;
    this.#selectTimer = setTimeout(() => {
      this.#selectTimer = undefined;
      void this.#requestCommit(sha);
    }, SELECTION_DEBOUNCE_MS);
  }

  async #requestCommit(sha: string): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const controller = new AbortController();
    this.#selectController = controller;
    const stillCurrent = (): boolean => this.#repoId === repoId && this.#sha === sha;
    try {
      const result = await this.#bridge.request(
        'commit.resolvePr',
        { repoId, sha },
        controller.signal,
      );
      if (!stillCurrent()) return;
      this.#applyCommitResult(sha, result);
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      // Fail-open (D9/§0.4): a transport-level failure (the socket itself, not a GitHub-side
      // classification — those always arrive as an ordinary `"unavailable"` result, never a
      // thrown error) simply leaves this selection unresolved. Nothing renders, nothing throws.
    } finally {
      if (this.#selectController === controller) this.#selectController = undefined;
    }
  }

  #applyCommitResult(sha: string, result: PrLookupResult): void {
    this.selected.value = result;
    if (result.kind === 'ok') {
      const next = new Map(this.bySha.value);
      next.set(sha, result.prs);
      this.bySha.value = next;
    } else if (result.kind === 'unavailable') {
      this.status.value = result.gh;
    } else if (result.kind === 'disabled') {
      this.#disabledForRepo = true;
    }
    this.generation.value++;
  }

  /** Warms `byBranch` for every branch in `branchNames` not already cached — see this class's own
   *  doc comment for why this takes an explicit list rather than D10's literal zero-argument
   *  signature. Safe to call repeatedly (e.g. on every `BranchPicker.vue` open): a branch already
   *  in `byBranch`, or already in flight, is skipped.
   *
   *  G30 round-1 performance review, finding #1: this used to `Promise.all` every branch at once —
   *  a repo with hundreds of branches fired hundreds of concurrent `branch.resolvePr` requests,
   *  with nothing anywhere in the stack capping it. The server side of this same finding (one bulk
   *  snapshot fetch instead of one GitHub call per branch) already answers "how much this costs
   *  GitHub"; a small worker pool here bounds "how many requests are ever in flight at once",
   *  independent of how many branches the repo has. */
  async ensureSnapshot(branchNames: readonly string[]): Promise<void> {
    const toFetch = branchNames.filter(
      (name) =>
        !this.byBranch.value.has(name) &&
        !this.#noBranchPr.has(name) &&
        !this.#branchRequests.has(name),
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < toFetch.length) {
        const name = toFetch[next];
        next += 1;
        if (name !== undefined) await this.resolveBranch(name);
      }
    };
    const workerCount = Math.min(PR_ENSURE_SNAPSHOT_CONCURRENCY, toFetch.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  /** Resolves one branch's own PR record — `BranchPicker.vue`'s `#123` badge and search's Refs
   *  scope arm call this (via `ensureSnapshot` or directly) for a branch not yet cached. A no-op
   *  when already cached or already in flight — safe to call from a render-adjacent path without
   *  its own dedup logic at the call site. */
  async resolveBranch(branch: string): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    if (this.#disabledForRepo) return;
    if (
      this.byBranch.value.has(branch) ||
      this.#noBranchPr.has(branch) ||
      this.#branchRequests.has(branch)
    )
      return;
    this.#branchRequests.add(branch);
    try {
      const result = await this.#bridge.request('branch.resolvePr', { repoId, branch });
      if (this.#repoId !== repoId) return;
      if (result.kind === 'ok') {
        const first = result.prs[0];
        if (first !== undefined) {
          const next = new Map(this.byBranch.value);
          next.set(branch, first);
          this.byBranch.value = next;
        } else {
          this.#noBranchPr.add(branch);
        }
        this.generation.value++;
      } else if (result.kind === 'unavailable') {
        this.status.value = result.gh;
      } else if (result.kind === 'disabled') {
        this.#disabledForRepo = true;
      }
    } catch {
      // Fail-open (D9/§0.4) — same posture as #requestCommit above.
    } finally {
      this.#branchRequests.delete(branch);
    }
  }

  dispose(): void {
    this.#selectController?.abort();
    if (this.#selectTimer !== undefined) clearTimeout(this.#selectTimer);
    this.#unsubscribe();
  }
}
