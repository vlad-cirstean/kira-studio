import type {
  RestackPreflight,
  RestackProgress,
  RestackResult,
  StackBranch,
  StackSummary,
} from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';
import type { PrState } from './pr.ts';

/** Every branch name across a `stack.list` result — `StackList.vue`'s own row set, and F13's own
 *  "warm `PrState.byBranch` for the whole stack view in one call" input. */
function allBranchNames(
  stacks: readonly StackSummary[],
  orphans: readonly StackBranch[],
): string[] {
  const names: string[] = [];
  for (const stack of stacks) {
    for (const branch of stack.branches) names.push(branch.name);
  }
  for (const orphan of orphans) names.push(orphan.name);
  return names;
}

/**
 * G26 D3/F13: the stack forest as reactive state, mirroring `WorktreeState`'s own shape (reloaded
 * on the same `repo.changed`/`refsChanged` signal, the same in-flight repo-switch guard on
 * `reload`). `previewRestack`/`runRestack`/`cancelRestack` are this class's own three mutating
 * entry points into `preflight.restack`/`stack.restack`/`stack.cancelRestack` — `StackDialog.vue`'s
 * whole restack flow is these three calls plus the reactive `restacking`/`progress` pair below.
 *
 * F13's own hand-forward is realized here exactly as G24 §9 anticipated: after every load, this
 * class calls `PrState.ensureSnapshot` with the union of every branch name in the result — no new
 * RPC, no new cache, no new rate-limit exposure beyond the snapshot G24 already fetches lazily.
 * `pr` is optional (mirroring `SearchState`'s own constructor) so a test — or a future host with no
 * GitHub surface at all — can construct this class without one.
 */
export class StackState {
  readonly stacks: ShallowRef<readonly StackSummary[]> = shallowRef([]);
  readonly orphans: ShallowRef<readonly StackBranch[]> = shallowRef([]);
  /** Bumped on every reload — `CommitGrid.vue`'s own `stack.generation` watcher (F12's fourth
   *  instance) re-renders the stale-branch decoration on this alone. */
  readonly generation: ShallowRef<number> = shallowRef(0);
  /** True for exactly the duration of one `runRestack` call — `StackList.vue`'s paused-restack
   *  strip and `AppToolbar.vue`'s own restacking strip both read this. */
  readonly restacking: ShallowRef<boolean> = shallowRef(false);
  /** Every `stack.progress` event seen during the CURRENT `runRestack` call, in arrival order —
   *  cleared at the start of each run. `StackDialog.vue`'s own live progress list. */
  readonly progress: ShallowRef<readonly RestackProgress[]> = shallowRef([]);

  readonly #bridge: BridgeClient;
  readonly #pr: PrState | undefined;
  #repoId: string | undefined;
  readonly #unsubscribeChanged: () => void;
  readonly #unsubscribeProgress: () => void;

  constructor(bridge: BridgeClient, pr?: PrState) {
    this.#bridge = bridge;
    this.#pr = pr;
    this.#unsubscribeChanged = bridge.on('repo.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      if (event.kind !== 'refsChanged') return;
      void this.reload();
    });
    this.#unsubscribeProgress = bridge.on('stack.progress', (event) => {
      if (this.#repoId !== event.repoId) return;
      this.progress.value = [...this.progress.value, event];
    });
  }

  /** Called once per repo open/close, exactly like `WorktreeState.setRepoId` — loads the new
   *  repo's own stack forest immediately rather than waiting on a `repo.changed` event a freshly
   *  opened repo has no reason to ever emit. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
    this.restacking.value = false;
    this.progress.value = [];
    if (repoId === undefined) {
      this.stacks.value = [];
      this.orphans.value = [];
      this.generation.value++;
      return;
    }
    void this.reload();
  }

  async reload(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const result = await this.#bridge.request('stack.list', { repoId });
    // A repo switch (or close) that lands while this request was in flight must not let a stale
    // reply overwrite the newer repo's own state — the same guard `WorktreeState.reload` makes.
    if (this.#repoId !== repoId) return;
    this.stacks.value = result.stacks;
    this.orphans.value = result.orphans;
    this.generation.value++;
    if (this.#pr !== undefined) {
      void this.#pr.ensureSnapshot(allBranchNames(result.stacks, result.orphans));
    }
  }

  /** `StackDialog.vue`'s own live preflight, re-run as the user opens the dialog or changes which
   *  branch it targets — a read, like `WorktreeState.previewAdd`, never gated by `restacking` and
   *  never itself mutating anything. */
  async previewRestack(branch: string): Promise<RestackPreflight | undefined> {
    const repoId = this.#repoId;
    if (repoId === undefined) return undefined;
    return this.#bridge.request('preflight.restack', { repoId, branch });
  }

  /** Runs the whole restack, then reloads (D16: the server already dropped its own stack cache on
   *  the write, but this class's own reactive `stacks`/`orphans` need their own fresh read the same
   *  way every other mutating call in this codebase reloads its own state after `op.run`/
   *  `remote.run` settles). `progress` is cleared at the start of THIS run, never accumulating
   *  across two restacks. */
  async runRestack(branch: string): Promise<RestackResult | undefined> {
    const repoId = this.#repoId;
    if (repoId === undefined) return undefined;
    this.restacking.value = true;
    this.progress.value = [];
    try {
      return await this.#bridge.request('stack.restack', { repoId, branch });
    } finally {
      this.restacking.value = false;
      if (this.#repoId === repoId) void this.reload();
    }
  }

  /** `stack.cancelRestack`'s own client — never an error, a cancel racing a just-finished restack
   *  is an ordinary outcome (the same `{cancelled: boolean}` shape `remote.cancel`/
   *  `worktree.cancelPrepare` already use). */
  async cancelRestack(): Promise<boolean> {
    const repoId = this.#repoId;
    if (repoId === undefined) return false;
    const result = await this.#bridge.request('stack.cancelRestack', { repoId });
    return result.cancelled;
  }

  dispose(): void {
    this.#unsubscribeChanged();
    this.#unsubscribeProgress();
  }
}
