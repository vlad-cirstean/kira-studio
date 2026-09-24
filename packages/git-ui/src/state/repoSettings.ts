import { SETTINGS } from '@kira/git-core';
import type { RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
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
    'kiraSpace.log.level': SETTINGS['kiraSpace.log.level'].default,
    'kiraSpace.github.enabled': SETTINGS['kiraSpace.github.enabled'].default,
    'kiraSpace.worktree.prepareScript': SETTINGS['kiraSpace.worktree.prepareScript'].default,
    'kiraSpace.worktree.basePath': SETTINGS['kiraSpace.worktree.basePath'].default,
    'kiraSpace.checkout.autoStash': SETTINGS['kiraSpace.checkout.autoStash'].default,
  };
}

/**
 * G18 D13: the per-repo display settings as reactive state, mirroring `StashState`'s own
 * "one instance for the life of the component, reset via `setRepoId`" shape (P9 W13) — a repo's
 * own settings are exactly as reset-on-switch as its stash stack.
 *
 * P72 §9.2: `kiraSpace.log.level`'s own cross-repo collapse (D14) is deleted, storage layer and
 * here together — `repoSettings.changed`'s own `repoId` naming a DIFFERENT repository than the one
 * this instance is currently tracking is irrelevant now for every field, log.level included, and
 * is ignored outright, the same as it always was for the other ten leaves. Kira Space's own
 * equivalent, genuinely app-wide `advanced.gitLogLevel`, lives in `SettingsState` instead
 * (`packages/shared/domain/settings.ts`), entirely separate from this per-repo mechanism.
 */
export class RepoSettingsState {
  readonly settings: ShallowRef<RepoSettingsSnapshot>;

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  readonly #unsubscribe: () => void;
  /** F5: one shared generation across `reload()`, `set()` and this event handler — bumped by
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
    void this.reload().catch((error) => this.#logBackgroundError('reload', error));
  }

  /** F10: a `void this.reload()`-shaped call (the only call site in this class) has no caller
   *  left to hand a rejection to — logging once here is what stands between a disconnect/git
   *  error and a silent unhandled rejection with the dialog left showing stale settings forever.
   *  `reload()` itself is unchanged and still throws for any future caller that awaits it. */
  #logBackgroundError(context: string, error: unknown): void {
    console.error(`RepoSettingsState: ${context} failed`, error);
  }

  async reload(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    // F5: claims this reload as the latest of the three writers of `settings` (this method,
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

  /** `RepoSettingsDialog.vue`'s own save path — patches only the field(s) actually changed
   *  (`RepoSettingsPatch`'s own `.partial()` shape) and adopts the server's own resulting
   *  snapshot as the new value, rather than optimistically applying the patch locally. F5: always
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

  dispose(): void {
    this.#unsubscribe();
  }
}
