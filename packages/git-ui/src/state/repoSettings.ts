import { SETTINGS } from '@kira/git-core';
import type { RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
import { type ShallowRef, shallowRef } from 'vue';
import type { BridgeClient } from '../bridge/client.ts';

/** The schema's own defaults, sourced rather than hand-copied (App.vue's `FALLBACK_PAGE_SIZE`'s
 *  own precedent) — used before the first `repoSettings.get` resolves, and whenever no repo is
 *  open (`setRepoId(undefined)`). */
function defaultRepoSettingsSnapshot(): RepoSettingsSnapshot {
  return {
    'kiraVersion.graph.pageSize': SETTINGS['kiraVersion.graph.pageSize'].default,
    'kiraVersion.graph.scope': SETTINGS['kiraVersion.graph.scope'].default,
    'kiraVersion.stash.showInGraph': SETTINGS['kiraVersion.stash.showInGraph'].default,
    'kiraVersion.stash.includeUntracked': SETTINGS['kiraVersion.stash.includeUntracked'].default,
    'kiraVersion.review.baseCandidates': SETTINGS['kiraVersion.review.baseCandidates'].default,
    'kiraVersion.pull.strategy': SETTINGS['kiraVersion.pull.strategy'].default,
    'kiraVersion.log.level': SETTINGS['kiraVersion.log.level'].default,
    'kiraVersion.github.enabled': SETTINGS['kiraVersion.github.enabled'].default,
    'kiraVersion.worktree.prepareScript': SETTINGS['kiraVersion.worktree.prepareScript'].default,
    'kiraVersion.worktree.basePath': SETTINGS['kiraVersion.worktree.basePath'].default,
  };
}

/**
 * G18 D13: the seven per-repo display settings as reactive state, mirroring `StashState`'s own
 * "one instance for the life of the component, reset via `setRepoId`" shape (P9 W13) — a repo's
 * own settings are exactly as reset-on-switch as its stash stack.
 *
 * **`kiraVersion.log.level`'s own cross-repo collapse (D14)** is handled here, not left for the
 * dialog to work around: `repoSettings.changed`'s own `repoId` may name a DIFFERENT repository
 * than the one this instance is currently tracking — for every field except `log.level` that
 * event is irrelevant (it is that other repo's own data) and is ignored outright; `log.level`
 * itself, being instance-wide, is merged in regardless of whose write triggered the event. This
 * is what lets two different `RepoSettingsDialog.vue` instances (or the same one, reopened
 * against a different repo) agree on `log.level` without either one polling for it.
 *
 * **`instanceWide` itself is not duplicated here** (D13) — `RepoSettingsDialog.vue` reads
 * `SETTINGS['kiraVersion.log.level'].instanceWide` straight off `@kira/git-core`'s own schema,
 * the same "one schema, one place" reason this whole per-repo mechanism exists.
 */
export class RepoSettingsState {
  readonly settings: ShallowRef<RepoSettingsSnapshot>;

  readonly #bridge: BridgeClient;
  #repoId: string | undefined;
  readonly #unsubscribe: () => void;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    this.settings = shallowRef(defaultRepoSettingsSnapshot());
    this.#unsubscribe = bridge.on('repoSettings.changed', (event) => {
      if (event.repoId === this.#repoId) {
        this.settings.value = event.settings;
        return;
      }
      // D14: a different repo's own write — every field in event.settings except log.level
      // belongs to a repository that is not this one and must not overwrite this repo's own
      // values. log.level is the one field that genuinely is this repo's own value too.
      const incoming = event.settings['kiraVersion.log.level'];
      if (this.settings.value['kiraVersion.log.level'] !== incoming) {
        this.settings.value = { ...this.settings.value, 'kiraVersion.log.level': incoming };
      }
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
    void this.reload();
  }

  async reload(): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const settings = await this.#bridge.request('repoSettings.get', { repoId });
    // A repo switch (or close) that lands while this request was in flight must not let a stale
    // response overwrite whatever is current now — StashState.reload's own guard, restated.
    if (this.#repoId !== repoId) return;
    this.settings.value = settings;
  }

  /** `RepoSettingsDialog.vue`'s own save path — patches only the field(s) actually changed
   *  (`RepoSettingsPatch`'s own `.partial()` shape) and adopts the server's own resulting
   *  snapshot as the new value, rather than optimistically applying the patch locally: for
   *  `kiraVersion.log.level` in particular, the server's answer already reflects D14's sentinel
   *  read-back, which a local merge could not reproduce on its own. */
  async set(patch: RepoSettingsPatch): Promise<void> {
    const repoId = this.#repoId;
    if (repoId === undefined) return;
    const settings = await this.#bridge.request('repoSettings.set', { repoId, patch });
    if (this.#repoId !== repoId) return;
    this.settings.value = settings;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
