import type { GitStatus, RepoCandidate, RepoOpenResult, RepoSummary } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client';

/**
 * `GitStatus`, the candidate list, and the active repo's summary (P3 W9) — the state the
 * live-data strip and (from P4 on) the repo/branch pickers read. Opening and picking are
 * requests, not policy: `pick()` returns whatever `repo.pick` answers and never opens it
 * itself (the UI decides, mirroring W8's own rule on the host side).
 */
export class RepoState {
  readonly git: ShallowRef<GitStatus>;
  readonly candidates: ShallowRef<readonly RepoCandidate[]> = shallowRef([]);
  readonly activeRepo: ShallowRef<RepoSummary | undefined> = shallowRef(undefined);
  readonly lastChange: ShallowRef<
    { readonly kind: 'refsChanged' | 'worktreeChanged'; readonly count: number } | undefined
  > = shallowRef(undefined);

  readonly #bridge: BridgeClient;
  #changeCount = 0;
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

  async open(path: string): Promise<RepoOpenResult> {
    const result = await this.#bridge.request('repo.open', { path });
    if (result.kind === 'ok') this.activeRepo.value = result.repo;
    if (result.kind === 'gitUnavailable') this.git.value = result.git;
    return result;
  }

  async pick(): Promise<string | null> {
    const { path } = await this.#bridge.request('repo.pick', {});
    return path;
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
