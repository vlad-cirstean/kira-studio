import type {
  ResultOf,
  WorktreeAddPreflight,
  WorktreeEntry,
  WorktreeRemovePreflight,
} from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';
import { createLatestRequest } from './latestRequest.ts';

/** P76 §9.1: what a "Create worktree here…" row action pre-fills `WorktreeDialog.vue`'s create
 *  phase with. Every field optional: the toolbar/palette entry point opens with `{}` and keeps
 *  today's defaults. */
export interface WorktreeCreateSeed {
  readonly mode?: 'existingBranch' | 'newBranch' | 'detach';
  readonly branch?: string;
  readonly startPoint?: string;
}

/**
 * G25 D1: the worktree list as reactive state, mirroring `StashState`'s/`RefsState`'s own shape —
 * reloaded on the same `repo.changed` signal `RefsState` already listens to (`kind ===
 * "refsChanged"`, D17's own `commonDir/worktrees` fix included), never a bespoke one. Never cached
 * beyond this one reactive value (D1's own doc comment: "never cached" on the SERVER side — this
 * class still holds the latest answer for the UI to read, same as every other `*State` class does,
 * it just never serves a stale answer across a `reload()`).
 */
export class WorktreeState {
  readonly entries: ShallowRef<readonly WorktreeEntry[]> = shallowRef([]);

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  readonly #unsubscribe: () => void;
  /** F5: a `refsChanged` event fired twice in quick succession can reply out of order — only the
   *  latest issued `reload()` is ever allowed to apply. */
  readonly #reloadRequest = createLatestRequest<ResultOf<'worktree.list'>>();

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    this.#unsubscribe = bridge.on('repo.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      if (event.kind !== 'refsChanged') return;
      void this.reload();
    });
  }

  /** Called once per repo open/close, exactly like `RefsState.setRepoId` — loads the new repo's
   *  worktree list immediately rather than waiting on a `repo.changed` event a freshly opened repo
   *  has no reason to ever emit. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
    if (repoId === undefined) {
      this.entries.value = [];
      return;
    }
    void this.reload();
  }

  async reload(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    // A repo switch (or close) that lands while this request was in flight must not let a stale
    // reply overwrite the newer repo's own state — the same guard `RefsState.reload` makes — and
    // F5: two `refsChanged` events in quick succession must not let the older one land last.
    const outcome = await this.#reloadRequest.run(
      (signal) => this.#bridge.request('worktree.list', { repoId }, signal),
      () => this.#repoId === repoId,
    );
    if (outcome.status === 'error') throw new Error(outcome.message);
    if (outcome.status !== 'ok') return;
    this.entries.value = outcome.value.worktrees;
  }

  /** `WorktreeDialog.vue`'s own live preflight (D4), re-run as the user edits the path/mode/
   *  branch/start point — a read, like `previewPullStrategy`/`previewRevertMainline`, never gated
   *  by `busy` and never itself mutating anything. */
  async previewAdd(params: {
    readonly path: string;
    readonly mode: 'existingBranch' | 'newBranch' | 'detach';
    readonly branch?: string;
    readonly startPoint?: string;
  }): Promise<WorktreeAddPreflight | undefined> {
    const repoId = this.#repoId;
    if (repoId === undefined) return undefined;
    return this.#bridge.request('preflight.worktreeAdd', { repoId, ...params });
  }

  /** The Remove action's own confirm-step read (D8) — shows the blocker/dirty verdict, and the
   *  exact confirmation token to type, before the destructive `op.run` call ever fires. */
  async previewRemove(path: string): Promise<WorktreeRemovePreflight | undefined> {
    const repoId = this.#repoId;
    if (repoId === undefined) return undefined;
    return this.#bridge.request('preflight.worktreeRemove', { repoId, path });
  }

  dispose(): void {
    this.#unsubscribe();
    this.#reloadRequest.abort();
  }
}
