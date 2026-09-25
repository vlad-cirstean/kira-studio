import type { EventPayload } from '@kira/git-ipc';
import type { BridgeClient } from '../bridge/client.ts';

/**
 * P113 F8: `RefsState`/`WorktreeState`/`StackState`/`StashState`/`OpsState` each wire the same
 * frame around their own `repo.changed` subscription — ignore an event for any other repo (and,
 * for four of the five, any event `kind` but the one that actually invalidates this class's own
 * data), track the active repoId for `reload()`'s own in-flight-repo-switch guard, and log a
 * background reload's rejection with this class's own name rather than let it become a silent
 * unhandled rejection. Each class's own `reload()` body (which bridge method, how the result
 * applies, its own `createLatestRequest` tracker) is untouched — only this surrounding wiring
 * moved out, so the latest-request-wins ordering itself is unchanged.
 *
 * `RepoSettingsState` listens on a different event (`repoSettings.changed`, no `kind` field) and
 * needs a bare generation counter instead of latest-request-wins (its own doc comment: a `set()`
 * must never be dropped as "superseded" the way a background reload can be) — a genuinely
 * different shape, left as written rather than forced through this class.
 */
export class RepoScopedReload {
  #repoId: string | undefined;
  readonly #logName: string;
  readonly #unsubscribe: () => void;

  constructor(
    bridge: BridgeClient,
    logName: string,
    opts: {
      /** Omitted: react to every `repo.changed` event for this repo (`OpsState`'s own shape — a
       *  ref write OR a worktree/index touch can both move its data). Set: react only to that
       *  event kind (`RefsState`/`WorktreeState`/`StackState`/`StashState`'s own shape). */
      kind?: EventPayload<'repo.changed'>['kind'];
      onChanged: () => void;
    },
  ) {
    this.#logName = logName;
    this.#unsubscribe = bridge.on('repo.changed', (event) => {
      if (this.#repoId !== event.repoId) return;
      if (opts.kind !== undefined && event.kind !== opts.kind) return;
      opts.onChanged();
    });
  }

  get repoId(): string | undefined {
    return this.#repoId;
  }

  /** Whether `repoId` is still the one this class is tracking — the same "does this answer still
   *  apply" check every `reload()`'s own `isStillCurrent` closure makes. */
  isCurrent(repoId: string): boolean {
    return this.#repoId === repoId;
  }

  /** Called once per repo open/close, before the caller's own reset/reload-or-clear body runs. */
  setRepoId(repoId: string | undefined): void {
    this.#repoId = repoId;
  }

  /** `void fn().catch(...)` tagged with this class's own log name — the fire-and-forget idiom
   *  every `setRepoId`/`repo.changed` handler in this file already repeated verbatim. */
  fireAndForget(context: string, fn: () => Promise<void>): void {
    void fn().catch((error) => this.#logBackgroundError(context, error));
  }

  #logBackgroundError(context: string, error: unknown): void {
    console.error(`${this.#logName}: ${context} failed`, error);
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
