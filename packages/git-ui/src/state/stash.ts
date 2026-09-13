import type { FileChange, StashEntry } from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { type ComputedRef, computed, type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';
import type { FileListMode } from './detail.ts';

/**
 * `docs/plans/P9.md` W13: the stash stack as reactive state, mirroring `RefsState`'s own shape
 * (P6 W12) closely enough that `StashList.vue` (W14) needs nothing bespoke to consume it — a
 * repo's stash stack is exactly as ref-shaped as its branches/tags, just addressed by
 * `stash@{index}`/sha instead of a name.
 *
 * **Refresh.** Reloaded on the same `repo.changed` signal `RefsState` already listens to
 * (`kind === "refsChanged"`), never a bespoke one: every stash mutation (push/apply/pop/drop/
 * branch) writes `refs/stash` like any other ref write, so `watcher.ts`'s existing refs-dir
 * coverage already fires it — `ops.ts`'s stash methods do not additionally call `reload()`
 * themselves.
 *
 * **Selection.** OQ4: a stash IS selectable like a commit, so this class holds the same
 * "selected sha + its loaded file list" shape `DetailState` holds for a commit (P5 W7), not a
 * derivative of it — the two selections are independent (selecting a stash does not touch
 * `DetailState`, and vice versa; `App.vue`/W14 decides which pane wins when both exist).
 */
export class StashState {
  readonly entries: ShallowRef<readonly StashEntry[]> = shallowRef([]);
  /** G28 D13: the global bucket's own list, reloaded on the same signal `entries` is (a
   *  `refs/kira/globalstash/**` write is a ref write like any other, already covered by
   *  `watcher.ts`'s existing refs-dir coverage, M4). A separate ref rather than folding into
   *  `entries` — `GlobalStashList.vue` is its own `BranchPicker` section (D13), and `selected`
   *  below searches both without either list needing to know about the other's own shape. */
  readonly globalEntries: ShallowRef<readonly StashEntry[]> = shallowRef([]);
  /** `null` selects nothing. Otherwise the sha of the entry whose file list `changes` holds —
   *  kept as a sha, not the `StashEntry` itself, so a stack reshuffle (another pop/drop) that
   *  drops this entry out of `entries` is detectable (`selected` below reads back `undefined`)
   *  rather than silently pinning a stale snapshot. */
  readonly selectedSha: ShallowRef<string | null> = shallowRef(null);
  readonly changes: ShallowRef<readonly FileChange[] | undefined> = shallowRef(undefined);
  readonly error: ShallowRef<string | undefined> = shallowRef(undefined);

  /** The selected entry itself, or `undefined` once it is no longer in EITHER list (G28 D13
   *  widens the search to `globalEntries` too — a selection does not know, or need to know,
   *  which bucket it came from) — `StashList.vue`/`GlobalStashList.vue`/`StashDetailPane.vue`
   *  read this, never re-derive it by scanning `entries` on their own. */
  readonly selected: ComputedRef<StashEntry | undefined>;

  // -------------------------------------------------------------------------------------
  // W14's detail pane. G21 D12: no more `mode`/`diff`/`diffError` — `StashDetailPane.vue`'s tree
  // opens VS Code's own native diff editor now (`actions.openInEditor`, with `fallbackSha:
  // entry.untrackedSha` for the untracked-file case `#requestFileDiff` used to retry, F12),
  // exactly like `DetailState` since the same phase. `selectedFile` survives: it still drives the
  // tree's own selected-row highlight and file cursor.
  // -------------------------------------------------------------------------------------
  readonly selectedFile: ShallowRef<number> = shallowRef(-1);
  readonly listMode: ShallowRef<FileListMode> = shallowRef('tree');
  readonly filter: ShallowRef<string> = shallowRef('');

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  #showController: AbortController | undefined;
  readonly #unsubscribe: () => void;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    this.selected = computed(() => {
      const sha = this.selectedSha.value;
      if (sha === null) return undefined;
      return (
        this.entries.value.find((entry) => entry.sha === sha) ??
        this.globalEntries.value.find((entry) => entry.sha === sha)
      );
    });
    this.#unsubscribe = bridge.on('repo.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      if (event.kind !== 'refsChanged') return;
      void this.reload();
      void this.reloadGlobal();
    });
  }

  /** Called once per repo open/close, exactly like `RefsState.setRepoId`/`DetailState.setRepoId`
   *  — loads the new repo's stash stack immediately rather than waiting on a `repo.changed` event
   *  that a freshly opened repo has no reason to ever emit. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
    if (repoId === undefined) {
      this.#clear();
      return;
    }
    this.selectedSha.value = null;
    this.changes.value = undefined;
    this.error.value = undefined;
    void this.reload();
    void this.reloadGlobal();
  }

  async reload(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const { entries } = await this.#bridge.request('stash.list', { repoId });
    // A repo switch (or close) that lands while this request was in flight must not let a stale
    // reply overwrite the newer repo's own state — the same guard `RefsState.reload` makes.
    if (this.#repoId !== repoId) return;
    this.entries.value = entries;
  }

  /** G28 D13: the global bucket's own reload — same shape as `reload()`, same stale-reply guard. */
  async reloadGlobal(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const { entries } = await this.#bridge.request('globalStash.list', { repoId });
    if (this.#repoId !== repoId) return;
    this.globalEntries.value = entries;
  }

  /** `StashList.vue`/`GlobalStashList.vue`'s row click/Enter, and the graph's own stash-node
   *  selection (OQ4) — `null` clears the selection without a round trip. Re-selecting the
   *  already-selected sha is a no-op, matching `DetailState.select`'s sibling convention for a
   *  commit row (P4). */
  select(sha: string | null): void {
    if (sha === this.selectedSha.value) return;
    this.#showController?.abort();
    this.selectedSha.value = sha;
    this.changes.value = undefined;
    this.error.value = undefined;
    this.selectedFile.value = -1;
    if (sha !== null) void this.#requestShow(sha, this.#scopeFor(sha));
  }

  /** G28 D13: which bucket sha belongs to, derived by membership rather than trusting a caller-
   *  supplied scope — `entries` is checked first (the far more common case), falling back to
   *  `globalEntries`; `'stack'` when neither list (yet) contains it, matching `stash.show`'s own
   *  "absent/'' means stack" default (D12) rather than sending an undefined scope. */
  #scopeFor(sha: string): 'stack' | 'global' {
    if (this.globalEntries.value.some((entry) => entry.sha === sha)) return 'global';
    return 'stack';
  }

  /** `StashDetailPane.vue`'s tree click/arrow-nav — mirrors `DetailState.selectFile` exactly (P5
   *  W8's own convention): purely the cursor/selection now (G21 D12), no diff to open from here —
   *  the tree's own `openFile` emit (D13) opens directly through `actions.openInEditor`. */
  selectFile(index: number): void {
    this.selectedFile.value = index;
  }

  setListMode(mode: FileListMode): void {
    this.listMode.value = mode;
  }

  setFilter(text: string): void {
    this.filter.value = text;
  }

  async #requestShow(sha: string, scope: 'stack' | 'global'): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const controller = new AbortController();
    this.#showController = controller;
    try {
      const result = await this.#bridge.request(
        'stash.show',
        { repoId, sha, scope },
        controller.signal,
      );
      if (this.selectedSha.value !== sha) return;
      this.changes.value = result.changes;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      if (this.selectedSha.value !== sha) return;
      this.error.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.#showController === controller) this.#showController = undefined;
    }
  }

  #clear(): void {
    this.#showController?.abort();
    this.entries.value = [];
    this.globalEntries.value = [];
    this.selectedSha.value = null;
    this.changes.value = undefined;
    this.error.value = undefined;
    this.selectedFile.value = -1;
  }

  dispose(): void {
    this.#unsubscribe();
    this.#showController?.abort();
  }
}
