import type { CommitStore } from '@kira/git-core';
import type {
  ChangeRequestLookup,
  ChangeRequestRecord,
  GitHostInfo,
  HostStatus,
} from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { TIMING } from '@workbench/behaviour/timing';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';
import { createCancellableTimer } from './cancellableTimer.ts';

/** `ensureSnapshot`'s own worker-pool cap — see that
 *  method's doc comment. Six, not one and not unbounded: small enough that a repo with hundreds of
 *  branches never opens more than a handful of requests at once, large enough that warming a
 *  normal-sized branch list still finishes in one or two batches rather than trickling one at a
 *  time. */
const CHANGE_REQUEST_ENSURE_SNAPSHOT_CONCURRENCY = 6;

/** The budget on `rebuildAncestry`'s breadth-first walk — bounds the cost to the loaded
 *  window rather than the repository: a long-lived `main` whose own tip has a PR would otherwise
 *  walk the entire loaded history on every rebuild. 50,000 rows is well past any window a session
 *  loads (`graph.loadMore`'s own default page size is 5,000), so this only ever fires
 *  against a pathological case, never an ordinary one. */
const CHANGE_REQUEST_ANCESTRY_WALK_BUDGET = 50_000;

/** Repos whose last-known PR facts are kept for an instant restore on a tab/repo switch. */
const CHANGE_REQUEST_REPO_CACHE_CAP = 8;

interface RepoFacts {
  readonly bySha: ReadonlyMap<string, readonly ChangeRequestRecord[]>;
  readonly byBranch: ReadonlyMap<string, ChangeRequestRecord>;
  readonly noBranchChangeRequest: ReadonlySet<string>;
}

/**
 * G24 D10: the one client-side owner of every change request fact this app renders — the graph
 * indicator's per-commit lookup, the branch-tip badges/search's per-branch lookup, and the single
 * `HostStatus` the commit-detail pane's failure line (D12) reads. Mirrors `DetailState.select`'s own
 * abort-and-recheck discipline for the per-commit half; the per-branch half is plain
 * request-then-cache, since a branch's own PR record has no "supersede on reselect" race the way a
 * rapidly-changing commit selection does.
 *
 * **Deviation from D10's literal signature, documented here:** `ensureSnapshot` takes the branch
 * names to warm (`readonly string[]`) rather than no arguments at all. D10 lists it as
 * `ensureSnapshot(): Promise<void>`, but this class holds no `RefsState` reference of its own (D10
 * threads only `bridge` into its constructor, exactly like `DetailState`) and so has no other way
 * to know which branches exist to warm.
 *
 * **Cost correction (G32 round-3 performance review, finding #3):** the paragraph this replaces
 * claimed `branch.resolveChangeRequest` answers every branch from `RepoEntry`'s own cached bulk snapshot at
 * zero extra host cost — true only for a branch the snapshot already lists as having an open PR.
 * One that doesn't falls through to the server's own per-branch `PullsForBranch` lookup, a real
 * host call. `ensureSnapshot`'s caller is therefore NOT free to warm "every known
 * branch" the way this class's own D10 name suggests — every call site is responsible for scoping
 * `branchNames` to what actually needs it (e.g. `BranchPicker.vue`'s own rendered/capped sections,
 * not its full branch list), not handed here as a blanket guarantee.
 */
export class ChangeRequestState {
  /** Per-commit PR records, populated only on a resolved `"ok"` answer — `columns.ts`'s own
   *  `ChangeRequestContext` reads this by sha. A sha simply absent from this map means "render nothing"
   *  (not-yet-resolved, in-flight, `disabled`, or `unavailable` all collapse to the same "nothing
   *  in the grid" outcome, D9's own "inert, never noisy" rule) — the grid never needs to
   *  distinguish those four itself. */
  readonly bySha: ShallowRef<ReadonlyMap<string, readonly ChangeRequestRecord[]>> = shallowRef(
    new Map(),
  );
  /** Per-branch PR record — `BranchPicker.vue`'s own `#123` badge and `matchRef`'s own `pr` arm
   *  (via `state/search.ts`) both read this by branch short name. Absent means "no known PR (yet,
   *  or at all)" — same "render nothing" rule as `bySha`. */
  readonly byBranch: ShallowRef<ReadonlyMap<string, ChangeRequestRecord>> = shallowRef(new Map());
  /** P74 §4.2: commits reachable from a PR branch's tip within the loaded graph window, keyed by
   *  sha. Derived from `byBranch`, never fetched: the value is the branch's own `ChangeRequestRecord`. Rebuilt
   *  by `rebuildAncestry`, never written any other way. */
  readonly changeRequestByAncestry: ShallowRef<ReadonlyMap<string, ChangeRequestRecord>> =
    shallowRef(new Map());
  /** Bumped on every change to `bySha`/`byBranch` — `CommitGrid.vue`'s own `pr.generation`
   *  watcher (a third instance of the `graphView.generation`/`search.searchGeneration` pattern)
   *  re-renders the message column on this alone. */
  readonly generation: ShallowRef<number> = shallowRef(0);
  /** The most recent non-`"ok"` `HostStatus` this instance has seen, from either lookup — D12's own
   *  "one line of `Status.Reason`" in the commit-detail pane reads this. Never used to decide
   *  what the grid renders (the grid only ever consults `bySha`/`byBranch`). */
  readonly status: ShallowRef<HostStatus | undefined> = shallowRef(undefined);
  /** The raw result of the most recently SETTLED `commit.resolveChangeRequests` for whichever sha
   *  is currently selected — `CommitMeta.vue`'s own change request row needs the full
   *  discriminated union (`disabled` ⇒ row absent; `unavailable` ⇒ `status.reason`; `ok` with an
   *  empty list ⇒ "No change request"; `ok` with entries ⇒ one row each), which `bySha`'s collapsed
   *  shape cannot answer on its own. `undefined` while nothing is selected or a request is still
   *  in-flight/debounced. */
  readonly selected: ShallowRef<ChangeRequestLookup | undefined> = shallowRef(undefined);
  /** The host serving this repo (its wording for change requests); `null` with no remote on a
   *  known host or with the host turned off. Labels read it, never a provider name. */
  readonly host: ShallowRef<GitHostInfo | null> = shallowRef(null);

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  #sha: string | null = null;
  #selectSha: string | undefined;
  readonly #selectTimer = createCancellableTimer(() => {
    if (this.#selectSha !== undefined) void this.#requestCommit(this.#selectSha);
  }, TIMING.preview);
  #selectController: AbortController | undefined;
  readonly #branchRequests = new Set<string>();
  /** Branches whose `branch.resolveChangeRequest` answer came back `"ok"` with no PR at all.
   *  `byBranch` only ever holds an actual `ChangeRequestRecord`, so a no-PR branch never appeared
   *  in it — `ensureSnapshot`'s own dedup filter (`!byBranch.has(name) &&
   *  !#branchRequests.has(name)`) then failed both checks forever, and every `BranchPicker.vue`
   *  open / search-scope change / stack reload re-issued `branch.resolveChangeRequest` for every
   *  PR-less branch, indefinitely. Tracked separately (rather than widening `byBranch`'s value
   *  type) so every existing `byBranch.value.get(name)` call site keeps meaning "the branch's PR,
   *  if any" with no signature change. */
  readonly #noBranchChangeRequest = new Set<string>();
  /** Set the first time EITHER lookup answers `"disabled"` for the current repo (gitHost.provider
   *  off off, or no host remote) — every later selection/branch resolve for this same repo then
   *  answers `"disabled"` synchronously, with no request at all, until the repo changes or
   *  refsChanged clears it (a remote could have been added since). Not required for correctness
   *  (a disabled repo already costs the server nothing beyond a settings/remote-cache read), but
   *  it means arrow-keying through a whole disabled repository's history issues zero requests
   *  rather than one debounced no-op per row. */
  #disabledForRepo = false;
  /** The repo's last seen `kiraSpace.gitHost.provider`; a different value drops every fact.
   *  `undefined` until the repo's first settings event, when the value only revalidates. */
  #hostSetting: string | undefined;
  readonly #unsubscribe: () => void;
  readonly #unsubscribeSettings: () => void;
  #headIndex: ReadonlyMap<string, readonly ChangeRequestRecord[]> = new Map();
  #headIndexGeneration = -1;
  /** Last-known facts of repos switched away from, oldest first. */
  readonly #repoFacts = new Map<string, RepoFacts>();
  /** Bumped by every `#clear()` — `setRepoId` (a repo switch) AND the `refsChanged` handler
   *  (same repo, server caches dropped) alike. `ensureSnapshot`'s worker pool and `resolveBranch`
   *  each capture this alongside `repoId` at their own start: a repo switch alone (`repoId`
   *  changing) already stopped a *different* repo's warm-up, but nothing stopped THIS repo's own
   *  warm-up/resolve from continuing to run — and apply its answers — straight through a
   *  same-repo `refsChanged` clear. */
  #clearGeneration = 0;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    // Stale-while-revalidate: the server keeps its own PR cache across a refs change and
    // refreshes it in the background, so the facts shown stay put and the answers swap in when the
    // re-requests below settle.
    this.#unsubscribe = bridge.on('repo.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      if (event.kind !== 'refsChanged') return;
      this.#revalidate();
    });
    this.#unsubscribeSettings = bridge.on('repoSettings.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      const provider = event.settings['kiraSpace.gitHost.provider'];
      const previous = this.#hostSetting;
      this.#hostSetting = provider;
      if (previous === provider) return;
      if (previous === undefined) {
        // First event since the repo opened: the prior value is unknown, so keep the restored facts
        // and refresh them in place instead of dropping them.
        this.#revalidate();
        return;
      }
      // Facts and the disabled memo belong to the previous host choice.
      const sha = this.#sha;
      this.#clear();
      this.#sha = sha;
      this.#revalidate();
    });
  }

  /** Called whenever the active repo changes — mirrors `RefsState`/`DetailState`'s own
   *  `setRepoId`: cancels any in-flight/debounced request, stashes the outgoing repo's facts and
   *  shows the incoming repo's last-known ones at once while a background revalidation runs. */
  setRepoId(repoId: string | undefined): void {
    const previous = this.#repoId;
    if (previous !== undefined) this.#stashFacts(previous);
    this.#repoId = repoId;
    this.#hostSetting = undefined;
    this.#clear();
    this.host.value = null;
    if (repoId !== undefined) void this.#loadHost(repoId);
    const facts = repoId === undefined ? undefined : this.#repoFacts.get(repoId);
    if (facts === undefined) return;
    this.bySha.value = facts.bySha;
    this.byBranch.value = facts.byBranch;
    this.#noBranchChangeRequest.clear();
    for (const name of facts.noBranchChangeRequest) this.#noBranchChangeRequest.add(name);
    this.generation.value++;
    void this.#revalidateBranches();
  }

  async #loadHost(repoId: string): Promise<void> {
    try {
      const { host } = await this.#bridge.request('gitHost.info', { repoId });
      if (this.#repoId === repoId) this.host.value = host;
    } catch {
      // Fail-open: labels fall back to their neutral wording until the next load.
    }
  }

  #stashFacts(repoId: string): void {
    this.#repoFacts.delete(repoId);
    this.#repoFacts.set(repoId, {
      bySha: this.bySha.value,
      byBranch: this.byBranch.value,
      noBranchChangeRequest: new Set(this.#noBranchChangeRequest),
    });
    for (const oldest of this.#repoFacts.keys()) {
      if (this.#repoFacts.size <= CHANGE_REQUEST_REPO_CACHE_CAP) break;
      this.#repoFacts.delete(oldest);
    }
  }

  #cancelInFlight(): void {
    this.#clearGeneration++;
    this.#selectController?.abort();
    this.#selectTimer.stop();
    this.#branchRequests.clear();
  }

  #clear(): void {
    this.#cancelInFlight();
    this.#sha = null;
    this.#noBranchChangeRequest.clear();
    this.#disabledForRepo = false;
    this.bySha.value = new Map();
    this.byBranch.value = new Map();
    this.changeRequestByAncestry.value = new Map();
    this.selected.value = undefined;
    this.status.value = undefined;
    this.generation.value++;
  }

  /** Same-repo refs change: keeps every fact on screen, re-asks for the selected commit and every
   *  branch with a PR, and applies each answer as it lands. PR-less branches drop to unknown
   *  without a request (each would cost a host call); the next render asks lazily. */
  #revalidate(): void {
    this.#cancelInFlight();
    this.#disabledForRepo = false;
    this.#noBranchChangeRequest.clear();
    if (this.#repoId !== undefined) void this.#loadHost(this.#repoId);
    const sha = this.#sha;
    if (sha !== null) void this.#requestCommit(sha);
    void this.#revalidateBranches();
  }

  async #revalidateBranches(): Promise<void> {
    const repoId = this.#repoId;
    const generation = this.#clearGeneration;
    const names = [...this.byBranch.value.keys()].filter((name) => !this.#branchRequests.has(name));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < names.length) {
        if (this.#repoId !== repoId || this.#clearGeneration !== generation) return;
        if (this.#disabledForRepo) return;
        const name = names[next];
        next += 1;
        if (name !== undefined) await this.#fetchBranch(name, repoId, generation, true);
      }
    };
    const workerCount = Math.min(CHANGE_REQUEST_ENSURE_SNAPSHOT_CONCURRENCY, names.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  /** Selection changed (`SelectionState`'s own sha, mirrored here by the caller, exactly as
   *  `DetailState.select` already is) — starts the selection debounce (`TIMING.preview`),
   *  aborting any in-flight request first. `null` clears the current selection's own result
   *  immediately, with no request. */
  select(sha: string | null): void {
    this.#selectController?.abort();
    this.#selectTimer.stop();
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
    this.#selectSha = sha;
    this.#selectTimer.start();
  }

  async #requestCommit(sha: string): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const controller = new AbortController();
    this.#selectController = controller;
    const stillCurrent = (): boolean => this.#repoId === repoId && this.#sha === sha;
    try {
      const result = await this.#bridge.request(
        'commit.resolveChangeRequests',
        { repoId, sha },
        controller.signal,
      );
      if (!stillCurrent()) return;
      this.#applyCommitResult(sha, result);
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      // Fail-open (D9/§0.4): a transport-level failure (the socket itself, not a host-side
      // classification — those always arrive as an ordinary `"unavailable"` result, never a
      // thrown error) simply leaves this selection unresolved. Nothing renders, nothing throws.
    } finally {
      if (this.#selectController === controller) this.#selectController = undefined;
    }
  }

  #applyCommitResult(sha: string, result: ChangeRequestLookup): void {
    this.selected.value = result;
    if (result.kind === 'ok') {
      const next = new Map(this.bySha.value);
      next.set(sha, result.changeRequests);
      this.bySha.value = next;
    } else if (result.kind === 'unavailable') {
      this.status.value = result.status;
    } else if (result.kind === 'disabled') {
      this.#markDisabled();
    }
    this.generation.value++;
  }

  #markDisabled(): void {
    this.#disabledForRepo = true;
    if (this.bySha.value.size > 0) this.bySha.value = new Map();
    if (this.byBranch.value.size > 0) this.byBranch.value = new Map();
    this.#noBranchChangeRequest.clear();
  }

  /** Warms `byBranch` for every branch in `branchNames` not already cached — see this class's own
   *  doc comment for why this takes an explicit list rather than the literal zero-argument
   *  signature. Safe to call repeatedly (e.g. on every `BranchPicker.vue` open): a branch already
   *  in `byBranch`, or already in flight, is skipped.
   *
   *  This used to `Promise.all` every branch at once — a repo with hundreds of branches fired
   *  hundreds of concurrent `branch.resolveChangeRequest` requests, with nothing anywhere
   *  in the stack capping it. The server side (one bulk snapshot fetch instead of one host call
   *  per branch) already answers "how much this costs the host"; a small worker pool here bounds
   *  "how many requests are ever in flight at once", independent of how many
   *  branches the repo has. */
  async ensureSnapshot(branchNames: readonly string[]): Promise<void> {
    const repoId = this.#repoId;
    // Captured once, before the pool ever starts — a repo switch OR a same-repo `refsChanged`
    // clear landing mid-warm-up must stop every worker from issuing its NEXT request, not just
    // stop this repo's answers from being applied (wasted host calls against a repo
    // nobody is looking at any more otherwise keep firing for as long as `toFetch` has entries).
    const generation = this.#clearGeneration;
    const toFetch = branchNames.filter(
      (name) =>
        !this.byBranch.value.has(name) &&
        !this.#noBranchChangeRequest.has(name) &&
        !this.#branchRequests.has(name),
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < toFetch.length) {
        if (this.#repoId !== repoId || this.#clearGeneration !== generation) return;
        const name = toFetch[next];
        next += 1;
        if (name !== undefined) await this.resolveBranch(name);
      }
    };
    const workerCount = Math.min(CHANGE_REQUEST_ENSURE_SNAPSHOT_CONCURRENCY, toFetch.length);
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
      this.#noBranchChangeRequest.has(branch) ||
      this.#branchRequests.has(branch)
    )
      return;
    // F9: captured alongside `repoId` — a same-repo `refsChanged` leaves `repoId` itself
    // unchanged, so that check alone cannot detect it; `generation` can.
    await this.#fetchBranch(branch, repoId, this.#clearGeneration, false);
  }

  async #fetchBranch(
    branch: string,
    repoId: string | undefined,
    generation: number,
    revalidating: boolean,
  ): Promise<void> {
    if (repoId === undefined) return;
    this.#branchRequests.add(branch);
    try {
      const result = await this.#bridge.request('branch.resolveChangeRequest', { repoId, branch });
      if (this.#repoId !== repoId || this.#clearGeneration !== generation) return;
      if (result.kind === 'ok') {
        const previous = this.byBranch.value.get(branch);
        const first = result.changeRequests[0];
        if (first !== undefined) {
          const next = new Map(this.byBranch.value);
          next.set(branch, first);
          this.byBranch.value = next;
          this.#noBranchChangeRequest.delete(branch);
        } else {
          if (previous !== undefined) {
            const next = new Map(this.byBranch.value);
            next.delete(branch);
            this.byBranch.value = next;
          }
          this.#noBranchChangeRequest.add(branch);
        }
        if (!revalidating || JSON.stringify(previous) !== JSON.stringify(first)) {
          this.generation.value++;
        }
      } else if (result.kind === 'unavailable') {
        this.status.value = result.status;
      } else if (result.kind === 'disabled') {
        this.#markDisabled();
        this.generation.value++;
      }
    } catch {
      // Fail-open (D9/§0.4) — same posture as #requestCommit above.
    } finally {
      // A clear that landed while this request was in flight already let a NEWER call for
      // the same branch name re-`add()` it under the current generation — this stale call's own
      // delete must not remove that entry (the classic "two owners, one shared boolean" bug: it
      // would let a second, duplicate concurrent fetch start for a branch already back in flight).
      if (this.#clearGeneration === generation) this.#branchRequests.delete(branch);
    }
  }

  /** P74 §4.2: rebuilds `changeRequestByAncestry` from the PR records currently in `byBranch` — a bounded
   *  breadth-first walk over `store`'s own packed parent array, run once per rebuild rather than
   *  once per rendered row. `store` is an explicit argument (this class holds no `CommitStore` of
   *  its own, only `bridge` — the same deviation `ensureSnapshot`'s own doc comment already
   *  documents, for the same reason: `ChangeRequestState` has no other way to reach one). Called by
   *  `CommitGrid.vue`'s existing `pr.generation`/`graphView.generation` triggers, before its own
   *  `invalidateRowHeights` — never a separate watcher, so a PR resolution and the ancestry it
   *  feeds always land in the same render pass.
   *
   *  **Base cutoff (P79 fix, Functional finding HIGH):** the walk used to have no stopping point
   *  at all — every ancestor of a PR head got tagged, including all of `main`'s own history
   *  behind the branch point, bounded only by `budget`'s own cost cap, never by correctness. Each
   *  seeded branch's own `record.baseRef` (D14's recorded base branch name) is now resolved to a
   *  loaded row via `store.rowOfBranchTip` — a local decoration lookup, no RPC — and that row's
   *  own ancestor set (also budget-bounded, computed once per unique `baseRef` since PRs commonly
   *  share one) is excluded from the walk: never tagged, never expanded past, mirroring
   *  `<base>..<branch>`'s own two-dot exclusion (§6.8's `review.files`). A `baseRef` not resolvable
   *  locally (outside the loaded window, or never fetched under that name) falls back to no
   *  exclusion for that one branch — `rowOfBranchTip`'s own doc comment on why an RPC-based
   *  fallback (a `mergeBase` request per PR) was declined in favor of this local-only answer.
   *
   *  `budget` defaults to `CHANGE_REQUEST_ANCESTRY_WALK_BUDGET` — overridable only so `pr.spec.ts` can prove
   *  the cutoff itself without building a 50,000-row fixture; no production caller passes it. */
  rebuildAncestry(store: CommitStore, budget = CHANGE_REQUEST_ANCESTRY_WALK_BUDGET): void {
    const next = new Map<string, ChangeRequestRecord>();
    // First-writer-wins queue: every branch tip seeds the walk at once, in `byBranch`'s own
    // iteration order, so a commit reachable from two PR branches keeps whichever branch's own
    // entry happened to iterate first — deterministic per rebuild, never re-decided mid-walk.
    const queue: number[] = [];
    const recordOfRow = new Map<number, ChangeRequestRecord>();
    for (const record of this.byBranch.value.values()) {
      const row = store.rowOfSha(record.headSha);
      if (row === -1) continue; // The tip is outside the loaded window — contributes nothing.
      if (recordOfRow.has(row)) continue;
      recordOfRow.set(row, record);
      queue.push(row);
    }

    // Base cutoff: every row reachable from a resolved `baseRef`'s own tip — excluded from the
    // walk below, never tagged with that base's own PR (there isn't one) nor with the PR whose
    // base it is. `budget` is shared with the main walk (the same closed-over variable, decremented
    // by both) since this is still one bounded cost, not a second budget stacked on top.
    const excludedRows = new Set<number>();
    const baseAncestorCache = new Map<string, ReadonlySet<number>>();
    const baseAncestorsOf = (baseRef: string): ReadonlySet<number> => {
      const cached = baseAncestorCache.get(baseRef);
      if (cached !== undefined) return cached;
      const visited = new Set<number>();
      const baseRow = store.rowOfBranchTip(baseRef);
      if (baseRow !== -1) {
        const baseQueue = [baseRow];
        visited.add(baseRow);
        let baseHead = 0;
        while (baseHead < baseQueue.length && budget > 0) {
          const row = baseQueue[baseHead];
          baseHead += 1;
          budget -= 1;
          if (row === undefined) continue;
          for (const parentRow of store.parentsOf(row)) {
            if (parentRow === -1 || visited.has(parentRow)) continue;
            visited.add(parentRow);
            baseQueue.push(parentRow);
          }
        }
      }
      baseAncestorCache.set(baseRef, visited);
      return visited;
    };
    for (const record of recordOfRow.values()) {
      for (const row of baseAncestorsOf(record.baseRef)) excludedRows.add(row);
    }

    const visited = new Set<number>(queue);
    let head = 0;
    while (head < queue.length && budget > 0) {
      const row = queue[head];
      head += 1;
      budget -= 1;
      if (row === undefined) continue;
      const record = recordOfRow.get(row);
      if (record === undefined) continue;
      if (excludedRows.has(row)) continue; // behind the PR's own base — not the PR's commit.
      next.set(store.shaAt(row), record);
      for (const parentRow of store.parentsOf(row)) {
        if (parentRow === -1 || visited.has(parentRow) || excludedRows.has(parentRow)) continue;
        visited.add(parentRow);
        recordOfRow.set(parentRow, record);
        queue.push(parentRow);
      }
    }
    this.changeRequestByAncestry.value = next;
  }

  /** P74 §4.2's own lookup order: `bySha` first (an authoritative per-commit answer from the host),
   *  `changeRequestByAncestry` second (a derivation, which must never override a real answer), `undefined`
   *  otherwise — every consumer already renders that as nothing. Returns the same
   *  `readonly ChangeRequestRecord[] | undefined` shape `bySha` itself does, so `CommitGrid.vue`'s `changeRequestsFor`
   *  accessor can call this directly with no reshaping. */
  changeRequestForCommit(sha: string): readonly ChangeRequestRecord[] | undefined {
    const direct = this.bySha.value.get(sha);
    if (direct !== undefined) return direct;
    const derived = this.changeRequestByAncestry.value.get(sha);
    return derived === undefined ? undefined : [derived];
  }

  /** The graph badge's lookup: only PRs whose head is exactly `sha` — from `byBranch` and from
   *  `bySha` entries whose `headSha` matches. Never ancestry: a branch's non-tip commits get none. */
  changeRequestsHeadedAt(sha: string): readonly ChangeRequestRecord[] | undefined {
    if (this.#headIndexGeneration !== this.generation.value) {
      const index = new Map<string, ChangeRequestRecord[]>();
      const add = (record: ChangeRequestRecord): void => {
        const list = index.get(record.headSha);
        if (list === undefined) index.set(record.headSha, [record]);
        else if (!list.some((r) => r.number === record.number)) list.push(record);
      };
      for (const record of this.byBranch.value.values()) add(record);
      for (const records of this.bySha.value.values()) for (const record of records) add(record);
      this.#headIndex = index;
      this.#headIndexGeneration = this.generation.value;
    }
    return this.#headIndex.get(sha);
  }

  dispose(): void {
    this.#selectController?.abort();
    this.#selectTimer.stop();
    this.#unsubscribe();
    this.#unsubscribeSettings();
  }
}
