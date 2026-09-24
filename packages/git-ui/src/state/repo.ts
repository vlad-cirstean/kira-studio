import type { GitStatus, RepoCandidate, RepoOpenResult, RepoSummary } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

/** P108 F4: `open()`'s own outcome union, widened with one more case no wire response ever
 *  carries — every caller's existing `if (outcome.kind !== 'ok') return;` guard already treats
 *  this exactly like any other non-'ok' result, so nothing at a call site needs to change to
 *  respect it. */
export type RepoOpenOutcome = RepoOpenResult | { readonly kind: 'superseded' };

/**
 * `GitStatus`, the candidate list, and the active repo's summary (P3 W9) — the state the
 * live-data strip and (from P4 on) the repo/branch pickers read. Opening is a request, not
 * policy: `open()` never decides which repo to open itself (the UI decides, mirroring W8's own
 * rule on the host side). The workspace's own folders are the only source of candidates
 * (G-UX D4) — there is no folder-picking request on this state.
 */
export class RepoState {
  readonly git: ShallowRef<GitStatus>;
  readonly candidates: ShallowRef<readonly RepoCandidate[]> = shallowRef([]);
  readonly activeRepo: ShallowRef<RepoSummary | undefined> = shallowRef(undefined);
  readonly lastChange: ShallowRef<
    { readonly kind: 'refsChanged' | 'worktreeChanged'; readonly count: number } | undefined
  > = shallowRef(undefined);
  /** P108 F4: true while any `open()` call is in flight (a worktree switch, a reveal-in-graph, a
   *  reconnect, a bootstrap candidate, a `NoRepositoryPanel` pick — every path funnels through
   *  this one method) — `NoRepositoryPanel.vue` disables its candidate buttons on this so a
   *  second pick can never race the first. */
  readonly opening: ShallowRef<boolean> = shallowRef(false);

  readonly #bridge: BridgeClient;
  #changeCount = 0;
  /** P108 F4: every `open()` call takes the next token and only the call still holding the
   *  latest one, once its own request resolves, is allowed to touch `activeRepo`/`git` — an
   *  earlier call's response landing after a later call has already started is discarded
   *  ('superseded') rather than winning by sheer luck of network timing. Mirrors
   *  `GraphViewState`'s own `#loadGeneration` (Part 18 F1) for the identical shape. */
  #openSequence = 0;
  readonly #unsubscribe: () => void;

  constructor(bridge: BridgeClient, initialGit: GitStatus) {
    this.#bridge = bridge;
    this.git = shallowRef(initialGit);
    this.#unsubscribe = bridge.on('repo.changed', (event) => {
      if (this.activeRepo.value?.repoId !== event.repoId) return;
      this.#changeCount++;
      this.lastChange.value = { kind: event.kind, count: this.#changeCount };
    });
  }

  async refreshList(): Promise<void> {
    const result = await this.#bridge.request('repo.list', {});
    this.candidates.value = result.candidates;
  }

  async open(path: string): Promise<RepoOpenOutcome> {
    const token = ++this.#openSequence;
    this.opening.value = true;
    try {
      const result = await this.#bridge.request('repo.open', { path });
      if (token !== this.#openSequence) return { kind: 'superseded' };
      if (result.kind === 'ok') this.activeRepo.value = result.repo;
      if (result.kind === 'gitUnavailable') this.git.value = result.git;
      return result;
    } finally {
      // A newer call already bumped the sequence past this one — that call owns `opening` now;
      // clearing it here would flip it false out from under the newer call still in flight.
      if (token === this.#openSequence) this.opening.value = false;
    }
  }

  async close(): Promise<void> {
    const repo = this.activeRepo.value;
    if (!repo) return;
    await this.#bridge.request('repo.close', { repoId: repo.repoId });
    this.activeRepo.value = undefined;
    this.lastChange.value = undefined;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
