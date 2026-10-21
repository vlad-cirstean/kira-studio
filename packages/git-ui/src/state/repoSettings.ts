import { SETTINGS } from '@kira/git-core';
import type { GitHostInfo, RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

/** The schema's own defaults, sourced rather than hand-copied (App.vue's `FALLBACK_PAGE_SIZE`'s
 *  own precedent) — used before the first `repoSettings.get` resolves, and whenever no repo is
 *  open (`setRepoId(undefined)`). */
function defaultRepoSettingsSnapshot(): RepoSettingsSnapshot {
  return {
    'kiraSpace.graph.pageSize': SETTINGS['kiraSpace.graph.pageSize'].default,
    'kiraSpace.graph.scope': SETTINGS['kiraSpace.graph.scope'].default,
    'kiraSpace.stash.showInGraph': SETTINGS['kiraSpace.stash.showInGraph'].default,
    'kiraSpace.stash.includeUntracked': SETTINGS['kiraSpace.stash.includeUntracked'].default,
    'kiraSpace.review.baseCandidates': SETTINGS['kiraSpace.review.baseCandidates'].default,
    'kiraSpace.pull.strategy': SETTINGS['kiraSpace.pull.strategy'].default,
    'kiraSpace.gitHost.provider': SETTINGS['kiraSpace.gitHost.provider'].default,
    'kiraSpace.worktree.prepareScript': SETTINGS['kiraSpace.worktree.prepareScript'].default,
    'kiraSpace.worktree.basePath': SETTINGS['kiraSpace.worktree.basePath'].default,
    'kiraSpace.checkout.autoStash': SETTINGS['kiraSpace.checkout.autoStash'].default,
  };
}

/**
 * The per-repo display settings as reactive state, mirroring `StashState`'s own
 * "one instance for the life of the component, reset via `setRepoId`" shape — a repo's
 * own settings are exactly as reset-on-switch as its stash stack.
 *
 * `repoSettings.changed` naming a different repository than the one tracked is ignored.
 */
export class RepoSettingsState {
  readonly settings: ShallowRef<RepoSettingsSnapshot>;
  /** Every registered git host provider, for the settings choice; loaded once by `loadProviders`. */
  readonly providers: ShallowRef<readonly GitHostInfo[]> = shallowRef([]);

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  readonly #unsubscribe: () => void;
  /** One shared generation across `reload()`, `set()` and this event handler — bumped by
   *  whichever of the three settles or arrives last, so a `reload()` (or a `set()`) left in
   *  flight when a fresher write settles or a live push arrives can never overwrite it with an
   *  older snapshot. Unlike `reload()`/`set()` elsewhere in this file, `set()`'s own result must
   *  never be silently dropped as "superseded" — the user is waiting on it — so this is a bare
   *  counter rather than `createLatestRequest` (which would also cancel `set()`'s own in-flight
   *  request out from under it when a `reload()` starts). */
  #generation = 0;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    this.settings = shallowRef(defaultRepoSettingsSnapshot());
    this.#unsubscribe = bridge.on('repoSettings.changed', (event) => {
      // A different repo's own write — every field in event.settings belongs to a repository
      // that is not this one and must not overwrite this repo's own values.
      if (event.repoId !== this.#repoId) return;
      this.#generation++;
      this.settings.value = event.settings;
    });
  }

  /** Called once per repo open/close, exactly like `RefsState.setRepoId`/`StashState.setRepoId`
   *  — loads the new repo's settings immediately rather than waiting on an event a freshly
   *  opened repo has no reason to ever emit. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
    if (repoId === undefined) {
      this.settings.value = defaultRepoSettingsSnapshot();
      return;
    }
    fireAndForget(this.reload(), 'repoSettings');
  }

  async reload(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    // Claims this reload as the latest of the three writers of `settings` (this method,
    // `set()`, the `repoSettings.changed` handler above) before awaiting — a second `reload()`,
    // a `set()` result or a live push that lands first bumps `#generation` further, so THIS
    // reply is recognized as stale once it finally does arrive.
    const generation = ++this.#generation;
    const settings = await this.#bridge.request('repoSettings.get', { repoId });
    // A repo switch (or close) that lands while this request was in flight must not let a stale
    // response overwrite whatever is current now — StashState.reload's own guard, restated.
    if (this.#repoId !== repoId || generation !== this.#generation) return;
    this.settings.value = settings;
  }

  /** `RepoSettingsDialog.vue`'s own save path — patches only the field(s) changed
   *  (`RepoSettingsPatch`'s own `.partial()` shape) and adopts the server's own resulting
   *  snapshot as the new value, rather than optimistically applying the patch locally. Always
   *  applies its own result (the user is waiting on it, unlike a background `reload()`) but bumps
   *  `#generation` first, so an in-flight `reload()` started before this call can never land on
   *  top of it afterward. */
  async set(patch: RepoSettingsPatch): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const settings = await this.#bridge.request('repoSettings.set', { repoId, patch });
    if (this.#repoId !== repoId) return;
    this.#generation++;
    this.settings.value = settings;
  }

  /** Loads the provider list the first time it is asked for; a failed load can be retried. */
  async loadProviders(): Promise<void> {
    if (this.providers.value.length > 0) return;
    const { providers } = await this.#bridge.request('gitHost.providers', {});
    this.providers.value = providers;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
